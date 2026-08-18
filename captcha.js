const crypto = require('node:crypto');

function generateChallenge() {
  const a = crypto.randomInt(2, 50);
  const b = crypto.randomInt(2, 20);
  const ops = [
    { op: '+', solve: a + b },
    { op: '-', solve: Math.max(a, b) - Math.min(a, b) },
    { op: '\u00d7', solve: a * b },
  ];
  const chosen = ops[crypto.randomInt(ops.length)];
  const left = chosen.op === '-' ? Math.max(a, b) : a;
  const right = chosen.op === '-' ? Math.min(a, b) : b;
  return { question: `${left} ${chosen.op} ${right}`, answer: String(chosen.solve) };
}

function svgCaptcha(question) {
  const lines = question.split(' ');
  const label = `${lines[0]} ${lines[1]} ${lines[2]} = ?`;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="170" height="48" viewBox="0 0 170 48" role="img" aria-label="captcha">
      <rect width="170" height="48" rx="8" fill="#eef2ff" stroke="#a5b4fc" stroke-width="1.5"/>
      <line x1="0" y1="${15 + Math.floor(Math.random() * 20)}" x2="170" y2="${15 + Math.floor(Math.random() * 20)}" stroke="#c7d2fe" stroke-width="1"/>
      <line x1="${Math.random() * 80}" y1="0" x2="${80 + Math.random() * 90}" y2="48" stroke="#c7d2fe" stroke-width="1"/>
      <text x="85" y="31" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#4338ca"
            text-anchor="middle" letter-spacing="2" style="font-style: italic">${label}</text>
    </svg>`;
}

module.exports = { generateChallenge, svgCaptcha };
