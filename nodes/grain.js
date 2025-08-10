// nodes/grain.js
// Realistic, non-tiling film grain (mattdesl-style 3D noise)

export const GrainNode = {
  label: 'Grain',

  defaults: {
    enabled: true,
    size: 1.0,
    amount: 0.4,
    shadows: 0.6,
    midtones: 0.8,
    highlights: 0.3,
    filmResolution: 1.0,
    chroma: 0.5,
    seed: Math.floor(Math.random() * 1000)
  },

  buildControls(container, settings, onChange) {
    const controls = [
      ['Size', 'size', 0.2, 4, 0.01],
      ['Amount', 'amount', 0, 2, 0.01],
      ['Shadows', 'shadows', 0, 1, 0.01],
      ['Midtones', 'midtones', 0, 1, 0.01],
      ['Highlights', 'highlights', 0, 1, 0.01],
      ['Film Resolution', 'filmResolution', 0, 1, 0.01],
      ['Chroma', 'chroma', 0, 1, 0.01],
      ['Seed', 'seed', 0, 1000, 1]
    ];
    controls.forEach(([label, key, min, max, step]) => {
      const wrap = document.createElement('div');
      wrap.className = 'control-row';
      const lbl = document.createElement('label');
      lbl.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = settings[key];
      input.addEventListener('input', () => {
        settings[key] = parseFloat(input.value);
        onChange();
      });
      wrap.appendChild(lbl);
      wrap.appendChild(input);
      container.appendChild(wrap);
    });
  },

  render(helpers, settings, inputTex, nodeIndex) {
    const { gl, canvas, texPool, linkProgram, VS_QUAD, bindAttributes } = helpers;

    if (!this._prog) {
      const vs = VS_QUAD;
      const fs = `#version 300 es
      precision highp float;
      in vec2 v_uv; out vec4 o;

      uniform sampler2D uInput;
      uniform float uSize, uAmount, uShadows, uMidtones, uHighlights, uFilmResolution, uChroma, uSeed;
      uniform vec2 uCanvas;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453 + uSeed);
      }
      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f*f*(3.0 - 2.0*f);
        float n000 = hash(i + vec3(0.0,0.0,0.0));
        float n100 = hash(i + vec3(1.0,0.0,0.0));
        float n010 = hash(i + vec3(0.0,1.0,0.0));
        float n110 = hash(i + vec3(1.0,1.0,0.0));
        float n001 = hash(i + vec3(0.0,0.0,1.0));
        float n101 = hash(i + vec3(1.0,0.0,1.0));
        float n011 = hash(i + vec3(0.0,1.0,1.0));
        float n111 = hash(i + vec3(1.0,1.0,1.0));
        return mix(
          mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
          mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
          f.z
        );
      }

      float lum(vec3 c) {
        return dot(c, vec3(0.2126, 0.7152, 0.0722));
      }

      void main() {
        vec4 src = texture(uInput, v_uv);
        if (src.a < 0.001) { o = src; return; }

        float L = lum(src.rgb);
        float shadowMask = smoothstep(0.0, 0.45, 0.45 - L) * uShadows;
        float midMask = clamp(1.0 - abs(L - 0.5) * 2.0, 0.0, 1.0) * uMidtones;
        float highlightMask = smoothstep(0.55, 1.0, L) * uHighlights;
        float tonal = clamp(shadowMask + midMask + highlightMask, 0.0, 1.0);
        if (tonal < 0.0001) { o = src; return; }

        float shortDim = min(uCanvas.x, uCanvas.y);

        // Prevent extreme frequencies that cause aliasing
        float freq = min(40.0 / uSize, shortDim * 0.5);

        // Add a random phase offset to break grid alignment
        vec2 randOffset = vec2(
            fract(sin(uSeed * 12.9898) * 43758.5453),
            fract(cos(uSeed * 78.233) * 43758.5453)
        );

        vec2 scaled = (v_uv + randOffset) * (uCanvas / shortDim) * freq;


        float grainL = noise(vec3(scaled, uSeed * 0.01));
        grainL = mix(0.5, grainL, uFilmResolution);

        vec3 grainRGB = vec3(grainL);
        if (uChroma > 0.0) {
          float gr = noise(vec3(scaled + 0.37, uSeed * 0.02));
          float gg = noise(vec3(scaled + 1.13, uSeed * 0.03));
          float gb = noise(vec3(scaled + 2.71, uSeed * 0.04));
          grainRGB = mix(vec3(grainL), vec3(gr, gg, gb), uChroma);
        }

        vec3 applied = src.rgb + (grainRGB - 0.5) * uAmount * tonal;
        o = vec4(clamp(applied, 0.0, 1.0), src.a);
      }`;

      this._prog = linkProgram(vs, fs);
    }

    const outFbo = (nodeIndex % 2 === 0) ? texPool.nodeOutA.fbo : texPool.nodeOutB.fbo;
    const outTex = (nodeIndex % 2 === 0) ? texPool.nodeOutA.tex : texPool.nodeOutB.tex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this._prog);
    bindAttributes(this._prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(gl.getUniformLocation(this._prog, 'uInput'), 0);

    gl.uniform2f(gl.getUniformLocation(this._prog, 'uCanvas'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uSize'), settings.size);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uAmount'), settings.amount);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uShadows'), settings.shadows);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uMidtones'), settings.midtones);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uHighlights'), settings.highlights);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uFilmResolution'), settings.filmResolution);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uChroma'), settings.chroma);
    gl.uniform1f(gl.getUniformLocation(this._prog, 'uSeed'), settings.seed);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return outTex;
  }
};
