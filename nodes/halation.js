// nodes/halation.js
export const HalationNode = {
  label: 'Halation',
  defaults: {
    enabled: true, amount: 0.6, radius: 40, threshold: 0.85, color: '#ff8b6b', iterations: 2,
    before: false, collapsed: false
  },

  // render(helpers, settings, inputTex, nodeIndex) -> returns texture
  render(helpers, settings, inputTex, nodeIndex){
    // Use the shared passes: maskPass, blurSeparable, tintPass, compositePass
    const { maskPass, blurSeparable, tintPass, compositePass, texPool } = helpers;
    maskPass(inputTex, parseFloat(settings.threshold), texPool.mask.fbo);
    const blurred = blurSeparable(texPool.mask.tex, parseFloat(settings.radius), parseInt(settings.iterations));
    const hex = settings.color.replace('#','');
    const r = parseInt(hex.substring(0,2),16)/255;
    const g = parseInt(hex.substring(2,4),16)/255;
    const b = parseInt(hex.substring(4,6),16)/255;
    tintPass(blurred, [r,g,b], texPool.tinted.fbo);
    // composite add (mode 2) to nodeOutA
    compositePass(inputTex, texPool.tinted.tex, parseFloat(settings.amount), 2, (nodeIndex%2===0)? texPool.nodeOutA.fbo : texPool.nodeOutB.fbo);
    return (nodeIndex%2===0)? texPool.nodeOutA.tex : texPool.nodeOutB.tex;
  },

  // buildControls(container, settings, onChange) — create UI controls specific to Halation
  buildControls(container, settings, onChange){
    // Amount
    container.appendChild(makeRange('Amount', settings, 'amount', 0, 2, 0.01, onChange));
    // Radius
    container.appendChild(makeRange('Radius (px)', settings, 'radius', 0, 200, 1, onChange));
    // Threshold
    container.appendChild(makeRange('Threshold', settings, 'threshold', 0.5, 0.99, 0.01, onChange));
    // Color
    container.appendChild(makeColor('Color', settings, 'color', onChange));
    // Iterations
    container.appendChild(makeRange('Iterations', settings, 'iterations', 1, 4, 1, onChange));
  }
};

// small UI helpers (local)
function makeRange(labelText, settingsObj, key, min, max, step, onChange){
  const row = document.createElement('div'); row.className='control-row';
  const label = document.createElement('label'); label.textContent = labelText;
  const range = document.createElement('input'); range.type='range'; range.min=min; range.max=max; range.step=step;
  range.value = settingsObj[key];
  const val = document.createElement('div'); val.className='tiny muted'; val.textContent = String(settingsObj[key]);
  range.addEventListener('input', ()=>{ settingsObj[key] = range.value; val.textContent = String(range.value); onChange(); });
  row.appendChild(label); row.appendChild(range); row.appendChild(val);
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
