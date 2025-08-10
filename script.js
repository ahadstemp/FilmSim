// script.js — central controller (module)
// Updated to pass GL helpers to nodes and register GrainNode.

import { HalationNode } from './nodes/halation.js';
import { GlowNode } from './nodes/glow.js';

const $ = id => document.getElementById(id);
const fileInput = $('file');
const fitBtn = $('fitBtn');
const downloadBtn = $('download');
const nodesContainer = $('nodesContainer');
const canvas = $('glcanvas');

let gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
if(!gl){ alert('WebGL2 required. Use a modern browser.'); throw new Error('WebGL2 required'); }

// Node registry
const NodeRegistry = {
  halation: HalationNode,
  glow: GlowNode,
};

// Active nodes (pipeline order).
let nodes = [
  { type: 'halation', settings: { ...HalationNode.defaults } },
  { type: 'glow', settings: { ...GlowNode.defaults } },
];

// Shared state
let sourceTex = null;
let imageRect = null;
let texPool = {};

// --------------- canvas sizing ---------------
function fitCanvas(){
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(400, Math.floor(rect.width - 16));
  const cssH = Math.max(300, Math.floor(window.innerHeight - 200));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
}
fitCanvas();
window.addEventListener('resize', ()=>{ fitCanvas(); initPool(); render(); });

// --------------- shader helpers (same as original) ---------------
function compileShader(src, type){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    console.error(gl.getShaderInfoLog(s));
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s));
  }
  return s;
}
function linkProgram(vsSrc, fsSrc){
  const vs = compileShader(vsSrc, gl.VERTEX_SHADER);
  const fs = compileShader(fsSrc, gl.FRAGMENT_SHADER);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    console.error(gl.getProgramInfoLog(p));
    throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

// basic fullscreen quad
const VS_QUAD = `#version 300 es
in vec2 a_pos; in vec2 a_uv; out vec2 v_uv;
void main(){ v_uv = a_uv; gl_Position = vec4(a_pos,0.0,1.0); }`;

const QUAD_BUF = new Float32Array([
  -1,-1, 0,0,
   1,-1, 1,0,
  -1, 1, 0,1,
   1, 1, 1,1,
]);

let quadVAO = null;
function setupQuad(){
  quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_BUF, gl.STATIC_DRAW);
}
setupQuad();

function bindAttributes(prog){
  gl.bindVertexArray(quadVAO);
  const pos = gl.getAttribLocation(prog, 'a_pos');
  const uv = gl.getAttribLocation(prog, 'a_uv');
  gl.enableVertexAttribArray(pos);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
}

// shader sources (identical to your app)
const FS_MASK = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform float u_threshold;
void main(){
  vec3 c = texture(u_tex, v_uv).rgb;
  float l = dot(c, vec3(0.299,0.587,0.114));
  float mask = smoothstep(u_threshold, 1.0, l);
  o = vec4(mask,mask,mask,1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_radius; uniform int u_horizontal;
float gaussian(float x, float sigma){ return exp(- (x*x) / (2.0 * sigma * sigma)); }
void main(){
  float sigma = max(1.0, u_radius / 3.0);
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for(int i=-4;i<=4;i++){
    float t = float(i);
    float w = gaussian(t, sigma);
    vec2 off = u_horizontal==1 ? vec2(t * u_texel.x, 0.0) : vec2(0.0, t * u_texel.y);
    sum += texture(u_tex, v_uv + off).rgb * w; wsum += w;
  }
  o = vec4(sum/wsum, 1.0);
}`;

const FS_TINT = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_mask; uniform vec3 u_tint;
void main(){
  float m = texture(u_mask, v_uv).r;
  float s = pow(m, 0.9);
  o = vec4(u_tint * s, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_base;
uniform sampler2D u_effect;
uniform float u_amount;
uniform int u_mode;
vec3 blendScreen(vec3 a, vec3 b){ return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 blendAdd(vec3 a, vec3 b){ return a + b; }
vec3 blendMultiply(vec3 a, vec3 b){ return a * b; }
vec3 overlayFast(vec3 a, vec3 b){ return mix(2.0*a*b, 1.0 - 2.0*(1.0-a)*(1.0-b), step(0.5,a)); }
vec3 softlightFast(vec3 a, vec3 b){
  return mix(a - (1.0 - 2.0*b) * a * (1.0 - a), a + (2.0*b - 1.0) * (sqrt(a) - a), step(0.5,b));
}
vec3 overlayResolve(vec3 a, vec3 b){
  vec3 res;
  for(int i=0;i<3;i++){
    if(a[i] < 0.5) res[i] = 2.0*a[i]*b[i];
    else res[i] = 1.0 - 2.0*(1.0-a[i])*(1.0-b[i]);
  }
  return res;
}
vec3 softlightResolve(vec3 a, vec3 b){
  vec3 res;
  for(int i=0;i<3;i++){
    if(b[i] < 0.5){
      res[i] = a[i] - (1.0 - 2.0*b[i]) * a[i] * (1.0 - a[i]);
    } else {
      float d;
      if(a[i] < 0.25) d = ((16.0 * a[i] - 12.0) * a[i] + 4.0) * a[i];
      else d = sqrt(a[i]);
      res[i] = a[i] + (2.0*b[i] - 1.0) * (d - a[i]);
    }
  }
  return res;
}
void main(){
  vec3 base = texture(u_base, v_uv).rgb;
  vec3 eff = texture(u_effect, v_uv).rgb;
  vec3 blended;
  if(u_mode==0){ blended = eff; }
  else if(u_mode==1){ blended = blendScreen(base, eff); }
  else if(u_mode==2){ blended = blendAdd(base, eff); }
  else if(u_mode==3){ blended = overlayFast(base, eff); }
  else if(u_mode==4){ blended = softlightFast(base, eff); }
  else if(u_mode==5){ blended = blendMultiply(base, eff); }
  else if(u_mode==6){ blended = overlayResolve(base, eff); }
  else if(u_mode==7){ blended = softlightResolve(base, eff); }
  else { blended = eff; }
  vec3 outc = mix(base, blended, clamp(u_amount, 0.0, 1.0));
  if(u_amount > 1.0){ outc = base + (blended - base) * (u_amount); }
  o = vec4(outc, 1.0);
}`;

// compile programs once where needed
const progMask = linkProgram(VS_QUAD, FS_MASK);
const progBlur = linkProgram(VS_QUAD, FS_BLUR);
const progTint = linkProgram(VS_QUAD, FS_TINT);
const progComposite = linkProgram(VS_QUAD, FS_COMPOSITE);

// --------------- FBO / texture pool ---------------
function createTex(w, h){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function createFBO(t){
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const s = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if(s !== gl.FRAMEBUFFER_COMPLETE) console.warn('FBO incomplete', s);
  return f;
}

function initPool(){
  for(let k in texPool){
    try{ if(texPool[k].tex) gl.deleteTexture(texPool[k].tex); if(texPool[k].fbo) gl.deleteFramebuffer(texPool[k].fbo); }catch(e){}
  }
  texPool = {};
  const w = canvas.width, h = canvas.height;
  texPool.mask = { tex: createTex(w,h), fbo: createFBO(null) };
  texPool.tmp  = { tex: createTex(w,h), fbo: createFBO(null) };
  texPool.blur = { tex: createTex(w,h), fbo: createFBO(null) };
  texPool.tinted = { tex: createTex(w,h), fbo: createFBO(null) };
  texPool.nodeOutA = { tex: createTex(w,h), fbo: createFBO(null) };
  texPool.nodeOutB = { tex: createTex(w,h), fbo: createFBO(null) };
  texPool.mask.fbo = createFBO(texPool.mask.tex);
  texPool.tmp.fbo  = createFBO(texPool.tmp.tex);
  texPool.blur.fbo = createFBO(texPool.blur.tex);
  texPool.tinted.fbo = createFBO(texPool.tinted.tex);
  texPool.nodeOutA.fbo = createFBO(texPool.nodeOutA.tex);
  texPool.nodeOutB.fbo = createFBO(texPool.nodeOutB.tex);
}
initPool();

// --------------- shared passes (passed to nodes) ---------------
function maskPass(inputTex, threshold, outFBO){
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(progMask);
  bindAttributes(progMask);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inputTex);
  gl.uniform1i(gl.getUniformLocation(progMask, 'u_tex'), 0);
  gl.uniform1f(gl.getUniformLocation(progMask, 'u_threshold'), threshold);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function blurSeparable(inputTex, radius, iterations){
  let rad = radius;
  for(let i=0;i<iterations;i++){
    gl.bindFramebuffer(gl.FRAMEBUFFER, texPool.tmp.fbo);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.useProgram(progBlur);
    bindAttributes(progBlur);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, (i===0)? texPool.mask.tex : texPool.blur.tex);
    gl.uniform1i(gl.getUniformLocation(progBlur,'u_tex'), 0);
    gl.uniform2f(gl.getUniformLocation(progBlur,'u_texel'), 1.0/canvas.width, 1.0/canvas.height);
    gl.uniform1f(gl.getUniformLocation(progBlur,'u_radius'), rad);
    gl.uniform1i(gl.getUniformLocation(progBlur,'u_horizontal'), 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, texPool.blur.fbo);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texPool.tmp.tex);
    gl.uniform1i(gl.getUniformLocation(progBlur,'u_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(progBlur,'u_horizontal'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    rad *= 0.6;
  }
  return texPool.blur.tex;
}
function tintPass(maskTex, tintColor, outFBO){
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(progTint);
  bindAttributes(progTint);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.uniform1i(gl.getUniformLocation(progTint,'u_mask'), 0);
  gl.uniform3f(gl.getUniformLocation(progTint,'u_tint'), tintColor[0], tintColor[1], tintColor[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function compositePass(baseTex, effectTex, amount, mode, outFBO){
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(progComposite);
  bindAttributes(progComposite);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, baseTex);
  gl.uniform1i(gl.getUniformLocation(progComposite,'u_base'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, effectTex);
  gl.uniform1i(gl.getUniformLocation(progComposite,'u_effect'), 1);
  gl.uniform1f(gl.getUniformLocation(progComposite,'u_amount'), amount);
  gl.uniform1i(gl.getUniformLocation(progComposite,'u_mode'), mode);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// --------------- pipeline runner (uses node.render) ---------------
function runPipelineAndDraw(){
  if(!sourceTex){
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return;
  }

  let currentTex = sourceTex;
  for(let i=0;i<nodes.length;i++){
    const node = nodes[i];
    // ensure settings fields exist for backward compatibility
    node.settings.enabled = node.settings.enabled ?? true;
    node.settings.before = node.settings.before ?? false;
    node.settings.collapsed = node.settings.collapsed ?? false;

    if(!node.settings.enabled){
      compositePass(currentTex, currentTex, 0.0, 0, (i%2===0)? texPool.nodeOutA.fbo : texPool.nodeOutB.fbo);
      currentTex = (i%2===0)? texPool.nodeOutA.tex : texPool.nodeOutB.tex;
      continue;
    }
    if(node.settings.before){
      compositePass(currentTex, currentTex, 0.0, 0, (i%2===0)? texPool.nodeOutA.fbo : texPool.nodeOutB.fbo);
      currentTex = (i%2===0)? texPool.nodeOutA.tex : texPool.nodeOutB.tex;
      continue;
    }

    // Pass helpers object to node.render
    const def = NodeRegistry[node.type];
    const helpers = {
      gl, canvas, texPool,
      maskPass, blurSeparable, tintPass, compositePass,
      linkProgram, VS_QUAD, bindAttributes, progComposite
    };

    currentTex = def.render(helpers, node.settings, currentTex, i);
  }

  // final blit
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(progComposite);
  bindAttributes(progComposite);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, currentTex);
  gl.uniform1i(gl.getUniformLocation(progComposite,'u_base'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texPool.tmp.tex);
  gl.uniform1i(gl.getUniformLocation(progComposite,'u_effect'), 1);
  gl.uniform1f(gl.getUniformLocation(progComposite,'u_amount'), 0.0);
  gl.uniform1i(gl.getUniformLocation(progComposite,'u_mode'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// --------------- UI: central createNodeCard (delegates node-specific controls) ---------------
function createNodeCard(nodeObj, idx){
  const card = document.createElement('div');
  card.className = 'node-card';

  const header = document.createElement('div'); header.className='node-header';
  const title = document.createElement('div'); title.className='node-title'; title.textContent = NodeRegistry[nodeObj.type].label;
  const headerRight = document.createElement('div'); headerRight.style.display='flex'; headerRight.style.gap='6px';

  const up = document.createElement('button'); up.className='icon-btn'; up.innerHTML='↑';
  const down = document.createElement('button'); down.className='icon-btn'; down.innerHTML='↓';
  const toggleEnable = document.createElement('button'); toggleEnable.className='small-btn';
  toggleEnable.textContent = nodeObj.settings.enabled ? 'Enabled' : 'Disabled';
  const collapseBtn = document.createElement('button'); collapseBtn.className='small-btn';
  collapseBtn.textContent = nodeObj.settings.collapsed ? 'Expand' : 'Collapse';

  headerRight.appendChild(up); headerRight.appendChild(down); headerRight.appendChild(toggleEnable); headerRight.appendChild(collapseBtn);
  header.appendChild(title); header.appendChild(headerRight);
  card.appendChild(header);

  up.addEventListener('click', ()=>{
    if(idx===0) return;
    const tmp = nodes[idx-1]; nodes[idx-1] = nodes[idx]; nodes[idx] = tmp;
    rebuildUI(); render();
  });
  down.addEventListener('click', ()=>{
    if(idx===nodes.length-1) return;
    const tmp = nodes[idx+1]; nodes[idx+1] = nodes[idx]; nodes[idx] = tmp;
    rebuildUI(); render();
  });

  toggleEnable.addEventListener('click', ()=>{
    nodeObj.settings.enabled = !nodeObj.settings.enabled;
    toggleEnable.textContent = nodeObj.settings.enabled ? 'Enabled' : 'Disabled';
    render();
  });

  collapseBtn.addEventListener('click', ()=>{
    nodeObj.settings.collapsed = !nodeObj.settings.collapsed;
    collapseBtn.textContent = nodeObj.settings.collapsed ? 'Expand' : 'Collapse';
    rebuildUI();
  });

  if(!nodeObj.settings.collapsed){
    const controls = document.createElement('div'); controls.className='node-controls';
    // before/after toggle
    const beforeRow = document.createElement('div'); beforeRow.className='control-row';
    const beforeLabel = document.createElement('label'); beforeLabel.textContent = 'Before / After (bypass this node)';
    const beforeBtn = document.createElement('button'); beforeBtn.className='small-btn';
    beforeBtn.textContent = nodeObj.settings.before ? 'Showing Before' : 'Showing After';
    beforeBtn.addEventListener('click', ()=>{ nodeObj.settings.before = !nodeObj.settings.before; beforeBtn.textContent = nodeObj.settings.before ? 'Showing Before' : 'Showing After'; render(); });
    beforeRow.appendChild(beforeLabel); beforeRow.appendChild(beforeBtn);
    controls.appendChild(beforeRow);

    // delegate node-specific controls creation
    const def = NodeRegistry[nodeObj.type];
    def.buildControls(controls, nodeObj.settings, ()=>render());

    card.appendChild(controls);
  }

  return card;
}

function rebuildUI(){
  nodesContainer.innerHTML = '';
  for(let i=0;i<nodes.length;i++){
    const card = createNodeCard(nodes[i], i);
    nodesContainer.appendChild(card);
  }
}
rebuildUI();

// --------------- image upload & texture creation ---------------
function uploadImageToGL(img) {
  fitCanvas();
  const w = canvas.width, h = canvas.height;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');

  // Fill with transparency instead of black so grain only affects image area
  ctx.clearRect(0, 0, w, h);

  const ia = img.width / img.height;
  const ca = w / h;
  let dw, dh, dx, dy;
  if (ia > ca) {
    dw = w;
    dh = Math.round(w / ia);
    dx = 0;
    dy = Math.round((h - dh) / 2);
  } else {
    dh = h;
    dw = Math.round(h * ia);
    dy = 0;
    dx = Math.round((w - dw) / 2);
  }

  // Draw image in calculated position/size
  ctx.drawImage(img, dx, dy, dw, dh);

  // Store image rect for masking or shader UV adjustments
  imageRect = { dx: dx, dy: dy, dw: dw, dh: dh, canvasW: w, canvasH: h };

  // Create GL texture from offscreen canvas
  if (sourceTex) {
    try { gl.deleteTexture(sourceTex); } catch (e) {}
  }
  sourceTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sourceTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  initPool();
  render();
}


fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const i = new Image();
  i.onload = () => { uploadImageToGL(i); URL.revokeObjectURL(i.src); };
  i.src = URL.createObjectURL(f);
});
fitBtn.addEventListener('click', ()=>{ render(); });

// download
downloadBtn.addEventListener('click', ()=>{
  render();
  if(imageRect && imageRect.dw>0 && imageRect.dh>0){
    const tmp = document.createElement('canvas'); tmp.width = imageRect.dw; tmp.height = imageRect.dh;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(canvas, imageRect.dx, imageRect.dy, imageRect.dw, imageRect.dh, 0, 0, tmp.width, tmp.height);
    tmp.toBlob(blob=>{ const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='halation-node.png'; a.click(); URL.revokeObjectURL(url); }, 'image/png');
  } else {
    const url = canvas.toDataURL(); const a=document.createElement('a'); a.href=url; a.download='halation-node.png'; a.click();
  }
});

// --------------- render wrapper ---------------
function render(){
  if(!texPool.nodeOutA) initPool();
  runPipelineAndDraw();
}
render();
