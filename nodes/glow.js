// nodes/glow.js
export const GlowNode = {
  label: 'Glow',
  defaults: {
    enabled: true, amount: 0.0, radius: 40, threshold: 0.9, color: '#ffd4b2',
    iterations: 2, blend: 'Screen', resolveMode: false, before: false, collapsed: true
  },

  render(helpers, settings, inputTex, nodeIndex){
    const { maskPass, blurSeparable, tintPass, compositePass, texPool } = helpers;
    maskPass(inputTex, parseFloat(settings.threshold), texPool.mask.fbo);
    const blurred = blurSeparable(texPool.mask.tex, parseFloat(settings.radius), parseInt(settings.iterations));
    const hex = settings.color.replace('#','');
    const r = parseInt(hex.substring(0,2),16)/255;
    const g = parseInt(hex.substring(2,4),16)/255;
    const b = parseInt(hex.substring(4,6),16)/255;
    tintPass(blurred, [r,g,b], texPool.tinted.fbo);

    const modeMapFast = { 'Normal':0, 'Screen':1,'Add':2,'Overlay (Fast)':3,'SoftLight (Fast)':4,'Multiply':5 };
    const modeMapResolve = { 'Overlay (Resolve)':6,'SoftLight (Resolve)':7 };
    let mode = 0;
    if(settings.resolveMode && (settings.blend in modeMapResolve)) mode = modeMapResolve[settings.blend];
    else if(settings.blend in modeMapFast) mode = modeMapFast[settings.blend];
    else mode = modeMapFast[settings.blend] || 1;

    compositePass(inputTex, texPool.tinted.tex, parseFloat(settings.amount), mode, (nodeIndex%2===0)? texPool.nodeOutA.fbo : texPool.nodeOutB.fbo);
    return (nodeIndex%2===0)? texPool.nodeOutA.tex : texPool.nodeOutB.tex;
  },

  buildControls(container, settings, onChange){
    container.appendChild(makeRange('Amount', settings, 'amount', 0, 2, 0.01, onChange, true));
    container.appendChild(makeRange('Radius (px)', settings, 'radius', 0, 200, 1, onChange));
    container.appendChild(makeRange('Threshold', settings, 'threshold', 0.5, 0.99, 0.01, onChange));
    container.appendChild(makeColor('Tint', settings, 'color', onChange));
    container.appendChild(makeRange('Iterations', settings, 'iterations', 1, 4, 1, onChange));
    // blend mode select
    const blendRow = document.createElement('div'); blendRow.className='control-row';
    const blendLabel = document.createElement('label'); blendLabel.textContent = 'Blend Mode';
    const blendSelect = document.createElement('select');
    const blendOptions = ['Normal','Screen','Add','Overlay (Fast)','SoftLight (Fast)','Multiply','Overlay (Resolve)','SoftLight (Resolve)'];
    blendOptions.forEach(op=>{ const o=document.createElement('option'); o.value=o.textContent=op; blendSelect.appendChild(o); });
    blendSelect.value = settings.blend || 'Screen';
    blendSelect.addEventListener('change', ()=>{ settings.blend = blendSelect.value; onChange(); });
    blendRow.appendChild(blendLabel); blendRow.appendChild(blendSelect);
    container.appendChild(blendRow);

    const resolveRow = document.createElement('div'); resolveRow.className='control-row';
    const resolveLabel = document.createElement('label'); resolveLabel.textContent = 'Resolve Mode (enable to access Resolve-accurate Overlay/SoftLight)';
    const resolveBtn = document.createElement('button'); resolveBtn.className='small-btn';
    resolveBtn.textContent = settings.resolveMode ? 'Resolve ON' : 'Resolve OFF';
    resolveBtn.addEventListener('click', ()=>{ settings.resolveMode = !settings.resolveMode; resolveBtn.textContent = settings.resolveMode ? 'Resolve ON' : 'Resolve OFF'; onChange(); });
    resolveRow.appendChild(resolveLabel); resolveRow.appendChild(resolveBtn);
    container.appendChild(resolveRow);
  }
};

// local UI helpers
function makeRange(labelText, settingsObj, key, min, max, step, onChange, showValue){
  const row = document.createElement('div'); row.className='control-row';
  const label = document.createElement('label'); label.textContent = labelText + (showValue ? ` ` : '');
  const range = document.createElement('input'); range.type='range'; range.min=min; range.max=max; range.step=step;
  range.value = settingsObj[key];
  const val = document.createElement('div'); val.className='tiny muted'; val.textContent = String(settingsObj[key]);
  range.addEventListener('input', ()=>{ settingsObj[key] = range.value; val.textContent = String(range.value); onChange(); });
  row.appendChild(label); row.appendChild(range); if(showValue) row.appendChild(val);
  return row;
}
function makeColor(labelText, settingsObj, key, onChange){
  const row = document.createElement('div'); row.className='control-row';
  const label = document.createElement('label'); label.textContent = labelText;
  const inp = document.createElement('input'); inp.type='color'; inp.value = settingsObj[key];
  inp.addEventListener('input', ()=>{ settingsObj[key] = inp.value; onChange(); });
  row.appendChild(label); row.appendChild(inp);
  return row;
}
