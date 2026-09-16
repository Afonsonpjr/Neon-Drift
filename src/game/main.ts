import { GameModel, type Difficulty, type Phase } from './model';
import { GameScene } from './scene';
import { GameAudio } from './audio';

const STORAGE_KEY = 'neon-drift.best.v1';
const number = new Intl.NumberFormat('pt-BR');

export function boot() {
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing interface element: ${id}`);
    return found as T;
  };
  const app = element('app');
  if (app.dataset.ready) return;
  app.dataset.ready = 'true';
  const loading = element('loading');
  const startButton = element<HTMLButtonElement>('start-button');
  let storedBest = 0;
  try { storedBest = Number(localStorage.getItem(STORAGE_KEY)) || 0; } catch { /* Private storage is optional. */ }
  const model = new GameModel(storedBest);
  const audio = new GameAudio();
  let scene: GameScene;
  try {
    scene = new GameScene(element('scene'));
  } catch (error) {
    loading.hidden = true;
    const fallback = element('fatal'); fallback.hidden = false;
    fallback.textContent = 'Não foi possível iniciar o 3D. Ative a aceleração gráfica do navegador e recarregue a página.';
    console.error('WebGL initialization failed:', error);
    return;
  }
  loading.hidden = true; startButton.disabled = false;
  const cleanup = new AbortController();
  const signal = cleanup.signal;
  let previousPhase: Phase | undefined;
  let runBest = model.state.best;
  let animationId = 0;
  let last = performance.now();
  let hudTimer = 0;
  let toastTimer = 0;
  let impactTimer = 0;
  let disposed = false;
  let contextLost = false;
  const touchMedia = matchMedia('(pointer: coarse), (max-width: 700px)');
  const help = element<HTMLDialogElement>('help-dialog');
  const score = element('score'), best = element('best'), speed = element('speed');
  const distance = element('distance'), energy = element('energy-fill'), health = element('health'), combo = element('combo');
  const touch = element('touch-controls');
  const sound = element<HTMLButtonElement>('sound-button');
  const save = () => { try { localStorage.setItem(STORAGE_KEY, String(model.state.best)); } catch { /* Keep playing without persistent storage. */ } };
  const toast = (message: string) => {
    const node = element('toast'); node.textContent = message; node.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = window.setTimeout(() => node.classList.remove('visible'), 1800);
  };
  const renderHud = () => {
    const state = model.state;
    score.textContent = number.format(state.score).padStart(5, '0');
    best.textContent = number.format(state.best);
    speed.textContent = String(Math.round(state.speed * 3.6));
    distance.textContent = number.format(Math.floor(state.distance));
    energy.style.width = `${state.energy}%`;
    energy.parentElement?.setAttribute('aria-valuenow', String(Math.round(state.energy)));
    health.setAttribute('aria-label', `${state.health} de 3 escudos restantes`);
    Array.from(health.children).forEach((life, index) => life.classList.toggle('lost', index >= state.health));
    combo.textContent = state.combo > 1 ? `COMBO ×${Math.min(state.combo, 5)}` : 'COLETE ENERGIA';
    app.classList.toggle('boosting', state.boosting);
  };
  const syncPhase = () => {
    const phase = model.state.phase;
    if (phase === previousPhase) return;
    previousPhase = phase; app.dataset.phase = phase;
    element('start-screen').hidden = phase !== 'menu';
    element('hud').hidden = phase === 'menu';
    element('pause-screen').hidden = phase !== 'paused';
    element('gameover-screen').hidden = phase !== 'gameover';
    touch.hidden = phase !== 'playing' || !touchMedia.matches;
    element('menu-best').textContent = number.format(model.state.best).padStart(5, '0');
    app.setAttribute('aria-label', phase === 'playing' ? 'Corrida em andamento' : 'Neon Drift');
    if (phase === 'paused') element('resume-button').focus();
    if (phase === 'menu') startButton.focus({ preventScroll: true });
    if (phase === 'playing') {
      app.tabIndex = -1; app.focus({ preventScroll: true });
    }
    if (phase === 'gameover') {
      element('final-score').textContent = number.format(model.state.score);
      element('final-best').textContent = number.format(model.state.best);
      element('final-distance').textContent = number.format(Math.floor(model.state.distance));
      element('final-crystals').textContent = number.format(model.state.crystals);
      element('record-label').textContent = model.state.score > runBest ? 'NOVO RECORDE PESSOAL' : 'TENTE SUPERAR SEU RECORDE';
      save(); element('restart-button').focus();
    }
    renderHud();
  };
  const start = () => {
    if (contextLost) return;
    runBest = model.state.best;
    model.start(element<HTMLSelectElement>('difficulty').value as Difficulty);
    void audio.unlock(); audio.play('start');
    element('toast').classList.remove('visible');
    syncPhase();
  };
  const pause = () => { model.pause(); syncPhase(); save(); };
  const resume = () => { if (!contextLost) { model.resume(); last = performance.now(); syncPhase(); } };
  const home = () => { save(); model.goToMenu(); syncPhase(); };
  const bind = (id: string, callback: () => void) => element(id).addEventListener('click', callback, { signal });
  bind('start-button', start); bind('restart-button', start);
  bind('pause-button', pause); bind('resume-button', resume);
  bind('quit-button', home); bind('home-button', home);
  bind('help-button', () => { if (model.state.phase === 'playing') pause(); help.showModal(); });
  bind('close-help', () => help.close());
  help.addEventListener('click', (event) => { if (event.target === help) help.close(); }, { signal });
  bind('sound-button', () => {
    const enabled = audio.toggle();
    sound.setAttribute('aria-pressed', String(enabled));
    sound.setAttribute('aria-label', enabled ? 'Desativar som' : 'Ativar som');
    sound.title = enabled ? 'Desativar som' : 'Ativar som';
    toast(enabled ? 'Áudio ativado' : 'Áudio desativado');
  });
  bind('fullscreen-button', () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => toast('Não foi possível sair da tela cheia.'));
    else if (app.requestFullscreen) void app.requestFullscreen().catch(() => toast('Tela cheia indisponível neste navegador.'));
    else toast('Use a opção de tela cheia do navegador.');
  });
  document.addEventListener('fullscreenchange', () => {
    element('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia');
  }, { signal });
  const release = () => { model.setBoost(false); element('touch-boost').classList.remove('pressed'); };
  document.addEventListener('keydown', (event) => {
    if (help.open || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    const playing = model.state.phase === 'playing';
    if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp'].includes(event.code) && playing) event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Escape' || event.code === 'KeyP') {
      if (playing) pause(); else if (model.state.phase === 'paused') resume();
    }
    if (!playing) return;
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') model.steer(-1);
    if (event.code === 'ArrowRight' || event.code === 'KeyD') model.steer(1);
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') { model.setBoost(true); audio.play('boost'); }
  }, { signal });
  document.addEventListener('keyup', (event) => {
    if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) release();
  }, { signal });
  bind('touch-left', () => model.steer(-1)); bind('touch-right', () => model.steer(1));
  const boostButton = element('touch-boost');
  boostButton.addEventListener('pointerdown', (event) => {
    event.preventDefault(); boostButton.setPointerCapture(event.pointerId);
    model.setBoost(true); boostButton.classList.add('pressed'); audio.play('boost');
  }, { signal });
  boostButton.addEventListener('pointerup', release, { signal });
  boostButton.addEventListener('pointercancel', release, { signal });
  boostButton.addEventListener('lostpointercapture', release, { signal });
  let swipeX: number | undefined;
  const canvas = element('scene').querySelector('canvas')!;
  canvas.addEventListener('pointerdown', (event) => { swipeX = event.clientX; canvas.setPointerCapture(event.pointerId); }, { signal });
  canvas.addEventListener('pointerup', (event) => {
    if (swipeX !== undefined && Math.abs(event.clientX - swipeX) > 25) model.steer(event.clientX > swipeX ? 1 : -1);
    swipeX = undefined;
  }, { signal });
  canvas.addEventListener('pointercancel', () => { swipeX = undefined; release(); }, { signal });
  const background = () => { release(); if (model.state.phase === 'playing') pause(); save(); };
  window.addEventListener('blur', background, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) background(); last = performance.now(); }, { signal });
  touchMedia.addEventListener('change', () => { touch.hidden = model.state.phase !== 'playing' || !touchMedia.matches; }, { signal });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); contextLost = true; background();
    const fallback = element('fatal'); fallback.hidden = false;
    fallback.textContent = 'A conexão gráfica foi interrompida. Recarregue a página para voltar à pista.';
  }, { signal });
  const frame = (now: number) => {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!document.hidden && !contextLost) {
      const events = model.update(dt);
      for (const event of events) {
        if (event.type === 'collect') { audio.play('collect'); scene.burst(model.state.playerX); toast(`+${event.value} · Energia coletada`); }
        if (event.type === 'hit') {
          audio.play('hit'); scene.burst(model.state.playerX, true);
          element('impact').classList.add('active'); clearTimeout(impactTimer);
          impactTimer = window.setTimeout(() => element('impact').classList.remove('active'), 260);
          toast(event.value ? `Impacto! ${event.value} escudo${event.value > 1 ? 's' : ''} restante${event.value > 1 ? 's' : ''}` : 'Escudos esgotados');
        }
        if (event.type === 'gameover') audio.play('gameover');
        if (event.type === 'milestone') toast(`${number.format(event.value ?? 0)} pontos · Continue assim!`);
      }
      syncPhase();
      hudTimer += dt;
      if (hudTimer > 0.07) { renderHud(); hudTimer = 0; }
      audio.setEngine(model.state.speed, model.state.boosting, model.state.phase === 'playing');
      scene.render(model.state, dt);
    }
    animationId = requestAnimationFrame(frame);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; save(); cancelAnimationFrame(animationId);
    cleanup.abort(); clearTimeout(toastTimer); clearTimeout(impactTimer);
    audio.dispose(); scene.dispose();
  };
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); else background(); }, { signal });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  syncPhase(); animationId = requestAnimationFrame(frame);
}
