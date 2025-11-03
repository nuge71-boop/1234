// game.js — 임시 테스트 모듈
export function start(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  let t = 0;
  (function loop() {
    t += 0.016;
    ctx.fillStyle = '#0f1210';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7bd17b';
    const x = 120 + Math.cos(t) * 60;
    const y = 120 + Math.sin(t) * 60;
    ctx.fillRect(x, y, 30, 30); // 초록 네모가 빙글빙글 돌면 성공
    requestAnimationFrame(loop);
  })();
}
