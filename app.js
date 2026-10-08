/* =========================================================
   찬반토론 도우미
   - 서버/라이브러리 없이 동작하는 바닐라 JS
   - 모든 데이터는 localStorage에 저장 (접근 불가 시 메모리로 대체)
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     공통 유틸
     --------------------------------------------------------- */
  const PREFIX = 'debate-helper:';

  // localStorage 래퍼: 막혀 있거나 용량이 꽉 차도 예외 없이 메모리 값으로 동작
  const store = (function () {
    const mem = {};
    let ls = null;
    try {
      ls = window.localStorage;
      ls.setItem(PREFIX + '__test', '1');
      ls.removeItem(PREFIX + '__test');
    } catch (e) {
      ls = null;
    }
    return {
      get(key, fallback) {
        let raw = null;
        try { if (ls) raw = ls.getItem(PREFIX + key); } catch (e) { raw = null; }
        if (raw == null) raw = mem[key];
        if (raw == null) return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
      },
      set(key, value) {
        const raw = JSON.stringify(value);
        mem[key] = raw;
        try { if (ls) ls.setItem(PREFIX + key, raw); } catch (e) { /* 메모리에만 유지 */ }
      }
    };
  })();

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // 간단한 DOM 생성기: el('div', {class: 'a', onclick: fn}, [자식...])
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k in node && typeof v !== 'string') node[k] = v;
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    (children || []).forEach(c => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  const pad = n => String(n).padStart(2, '0');
  // 초 → "MM:SS" (60분 이상이면 분이 그대로 늘어남)
  const fmt = sec => pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  // 초 → "3분", "2분 30초", "45초"
  function fmtKo(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m && s) return m + '분 ' + s + '초';
    if (m) return m + '분';
    return s + '초';
  }
  // 단계 칩용 짧은 표기 "3:00"
  const fmtShort = sec => Math.floor(sec / 60) + ':' + pad(sec % 60);

  let uidSeq = 0;
  const uid = () => Date.now().toString(36) + (uidSeq++).toString(36) + Math.random().toString(36).slice(2, 6);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // 글자를 입력하는 칸에 포커스가 있을 때만 단축키를 막는다 (체크박스·라디오는 제외)
  const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'];
  const isTyping = target => !!target && (
    target.isContentEditable ||
    target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
    (target.tagName === 'INPUT' && !NON_TEXT_INPUTS.includes(target.type))
  );
  const isToggleLike = target => !!target && (target.tagName === 'BUTTON' ||
    (target.tagName === 'INPUT' && ['checkbox', 'radio'].includes(target.type)));

  // 타이머 단계의 발언 측
  const SIDES = ['pro', 'con', 'aud', 'all'];
  const SIDE_LABEL = { pro: '찬성', con: '반대', aud: '청중', all: '전체', none: '미배정' };
  const SIDE_BADGE = { pro: '찬성 측', con: '반대 측', aud: '청중', all: '전체' };
  // 학생 진영 (이름 클릭 시 이 순서로 바뀜)
  const CAMPS = ['pro', 'con', 'aud'];
  const nextCamp = side => CAMPS[(CAMPS.indexOf(side) + 1) % CAMPS.length];

  /* ---------------------------------------------------------
     테마 (라이트/다크)
     --------------------------------------------------------- */
  const Theme = {
    init() {
      let theme = store.get('theme', null);
      if (theme !== 'light' && theme !== 'dark') {
        theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      this.apply(theme);
      $('#theme-toggle').addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        this.apply(next);
        store.set('theme', next);
      });
    },
    apply(theme) {
      document.documentElement.dataset.theme = theme;
      $('#theme-toggle .theme-label').textContent = theme === 'dark' ? '☀ 라이트 모드' : '☾ 다크 모드';
    }
  };

  /* ---------------------------------------------------------
     탭 전환
     --------------------------------------------------------- */
  const Tabs = {
    current: 'run',
    listeners: [],
    init() {
      $$('.tab').forEach(btn => btn.addEventListener('click', () => this.show(btn.dataset.tab)));
      // 이전 버전의 탭 이름(timer/speech)은 합쳐진 '진행' 탭으로
      const saved = store.get('tab', 'run');
      this.show(saved === 'groups' ? 'groups' : 'run');
    },
    show(name) {
      this.current = name;
      $$('.tab').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.tab === name)));
      $$('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
      store.set('tab', name);
      this.listeners.forEach(fn => fn(name));
    },
    onChange(fn) { this.listeners.push(fn); }
  };

  /* ---------------------------------------------------------
     알림음 (Web Audio API로 직접 생성)
     --------------------------------------------------------- */
  const Sound = {
    ctx: null,
    // 브라우저 자동재생 정책 때문에 사용자 조작 시점에 컨텍스트를 만들어 둔다
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return this.ctx;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
      return this.ctx;
    },
    play(pattern) {
      const ctx = this.unlock();
      if (!ctx) return;
      try {
        const t0 = ctx.currentTime + 0.03;
        pattern.forEach(([offset, freq, dur]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0 + offset);
          gain.gain.exponentialRampToValueAtTime(0.6, t0 + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0 + offset);
          osc.stop(t0 + offset + dur + 0.05);
        });
      } catch (e) { /* 소리 실패는 무시 */ }
    },
    alarm() { this.play([[0, 880, 0.22], [0.3, 880, 0.22], [0.6, 1320, 0.7]]); },
    test() { this.play([[0, 1046, 0.15]]); }
  };

  /* =========================================================
     탭 1. 찬반토론 단계 타이머
     ========================================================= */
  const DEFAULT_STEPS = [
    ['찬성 측 입론', 'pro', 180, '주장과 근거를 분명하게 제시합니다.'],
    ['반대 측 입론', 'con', 180, '주장과 근거를 분명하게 제시합니다.'],
    ['작전 시간', 'all', 60, '모둠별로 교차질의와 반론을 준비합니다.'],
    ['반대 측 교차질의', 'con', 120, '질문은 짧게, 답변은 질문한 내용에만 합니다.'],
    ['찬성 측 교차질의', 'pro', 120, '질문은 짧게, 답변은 질문한 내용에만 합니다.'],
    ['찬성 측 반론', 'pro', 120, '새로운 주장 없이 상대 논거를 반박합니다.'],
    ['반대 측 반론', 'con', 120, '새로운 주장 없이 상대 논거를 반박합니다.'],
    ['찬성 측 최종발언', 'pro', 60, '토론 내용을 정리하고 핵심을 강조합니다.'],
    ['반대 측 최종발언', 'con', 60, '토론 내용을 정리하고 핵심을 강조합니다.']
  ];
  const MIN_STEP_SEC = 5;
  const MAX_STEP_SEC = 99 * 60 + 59;
  const WARN_SEC = 30;

  const makeDefaultSteps = () => DEFAULT_STEPS.map(([name, side, sec, memo]) => ({ id: uid(), name, side, sec, memo }));

  // 저장된 값이 깨져 있어도 안전하게 정리
  function sanitizeSteps(list) {
    if (!Array.isArray(list)) return null;
    const out = list
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        id: typeof s.id === 'string' ? s.id : uid(),
        name: String(s.name == null ? '' : s.name).slice(0, 60),
        side: SIDES.includes(s.side) ? s.side : 'all',
        sec: Math.min(MAX_STEP_SEC, Math.max(MIN_STEP_SEC, Math.round(Number(s.sec)) || 60)),
        memo: String(s.memo == null ? '' : s.memo).slice(0, 200)
      }));
    return out.length ? out : null;
  }

  const Timer = {
    steps: sanitizeSteps(store.get('steps')) || makeDefaultSteps(),
    topic: String(store.get('topic', '') || ''),
    sound: store.get('sound', true) !== false,
    auto: store.get('auto', false) === true,
    presets: (Array.isArray(store.get('presets', [])) ? store.get('presets', []) : [])
      .filter(p => p && typeof p.name === 'string' && Array.isArray(p.steps))
      .map(p => Object.assign({}, p, { id: typeof p.id === 'string' ? p.id : uid() })),
    idx: 0,
    curId: null,
    elapsedBase: 0,   // 일시정지 전까지 누적된 경과(ms)
    runStart: null,   // 현재 진행 구간 시작 시각(ms), 정지 중이면 null
    alarmed: false,   // 이번 단계에서 0초 알림을 이미 울렸는지
    lastRender: '',
    lastSide: null,
    sideListeners: [],   // 현재 단계의 발언 측이 바뀔 때 알림 (발언 기록판 강조 연동)
    tickHandle: null,

    /* ----- 상태 계산 ----- */
    get running() { return this.runStart !== null; },
    get step() { return this.steps[this.idx]; },
    elapsed() { return this.elapsedBase + (this.running ? Date.now() - this.runStart : 0); },
    remainingMs() { return this.step.sec * 1000 - this.elapsed(); },
    totalRemainingSec() {
      const cur = Math.max(0, Math.ceil(this.remainingMs() / 1000));
      return this.steps.slice(this.idx + 1).reduce((sum, s) => sum + s.sec, cur);
    },

    /* ----- 조작 ----- */
    start() {
      if (this.running) return;
      if (this.sound) Sound.unlock();
      this.runStart = Date.now();
      this.ensureTick();
      this.render();
    },
    pause() {
      if (!this.running) return;
      this.elapsedBase += Date.now() - this.runStart;
      this.runStart = null;
      this.render();
    },
    toggle() { this.running ? this.pause() : this.start(); },
    resetCurrent() {
      this.elapsedBase = 0;
      this.runStart = null;
      this.alarmed = false;
      this.render();
    },
    // 다른 단계로 이동: 수동 이동은 정지 상태로, 자동 넘김은 계속 진행
    goTo(i, keepRunning) {
      if (i < 0 || i >= this.steps.length) return;
      const wasRunning = this.running;
      this.idx = i;
      this.curId = this.steps[i].id;
      this.elapsedBase = 0;
      this.alarmed = false;
      this.runStart = keepRunning && wasRunning ? Date.now() : null;
      this.renderStepbar();
      this.render();
    },
    next() { this.goTo(this.idx + 1, false); },
    prev() { this.goTo(this.idx - 1, false); },

    tick() {
      if (this.running && !this.alarmed && this.remainingMs() <= 0) {
        this.alarmed = true;
        if (this.sound) Sound.alarm();
        if (this.auto) {
          if (this.idx < this.steps.length - 1) {
            this.goTo(this.idx + 1, true);
            return;
          }
          this.pause();  // 마지막 단계면 멈춤
        }
      }
      this.render();
    },
    ensureTick() {
      if (!this.tickHandle) this.tickHandle = setInterval(() => this.tick(), 100);
    },

    /* ----- 단계 목록 변경 후 현재 위치 보정 ----- */
    // 순서 변경/추가/수정: 현재 단계를 id로 다시 찾아 경과 시간을 그대로 이어감
    // 현재 단계가 삭제됨: 같은 자리(또는 마지막) 단계로 이동하고 정지·초기화
    stepsChanged() {
      const found = this.steps.findIndex(s => s.id === this.curId);
      if (found >= 0) {
        this.idx = found;
        if (this.remainingMs() > 0) this.alarmed = false;
      } else {
        this.idx = Math.min(this.idx, this.steps.length - 1);
        this.curId = this.steps[this.idx].id;
        this.elapsedBase = 0;
        this.runStart = null;
        this.alarmed = false;
      }
      this.saveSteps();
      this.renderStepbar();
      this.render();
      this.renderConfigSummary();
    },
    // 구성을 통째로 교체(불러오기/기본값): 첫 단계부터 새로 시작
    replaceSteps(steps) {
      this.steps = steps;
      this.idx = 0;
      this.curId = steps[0].id;
      this.elapsedBase = 0;
      this.runStart = null;
      this.alarmed = false;
      this.saveSteps();
      this.renderStepbar();
      this.render();
      this.renderConfigTable();
    },
    saveSteps() { store.set('steps', this.steps); },

    /* ----- 진행 화면 렌더링 ----- */
    renderStepbar() {
      const bar = $('#stepbar');
      bar.textContent = '';
      this.steps.forEach((s, i) => {
        const cls = ['step-chip'];
        if (i < this.idx) cls.push('done');
        if (i === this.idx) cls.push('current');
        bar.appendChild(el('li', null, [
          el('button', {
            type: 'button',
            class: cls.join(' '),
            dataset: { side: s.side, index: String(i) },
            'aria-current': i === this.idx ? 'step' : null,
            title: (i + 1) + '단계로 이동',
            onclick: () => this.goTo(i, false)
          }, [
            el('span', { class: 'chip-top' }, [
              el('span', { text: (i < this.idx ? '✓ ' : '') + (i + 1) }),
              el('span', { class: 'chip-side', text: SIDE_LABEL[s.side] })
            ]),
            el('span', { class: 'chip-name', text: s.name || '(이름 없음)' }),
            el('span', { class: 'chip-time', text: fmtShort(s.sec) })
          ])
        ]));
      });
      const cur = bar.querySelector('.current');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },

    render() {
      const s = this.step;
      const rem = this.remainingMs();
      const over = rem <= 0;
      const remSec = over ? Math.floor(-rem / 1000) : Math.ceil(rem / 1000);
      const warn = !over && remSec <= WARN_SEC;
      const started = this.elapsed() > 0;
      const clockText = over ? '+' + fmt(remSec) : fmt(remSec);
      const state = over ? 'over' : warn ? 'warn' : '';
      const pausedMid = !this.running && started;

      if (s.side !== this.lastSide) {
        this.lastSide = s.side;
        this.sideListeners.forEach(fn => fn(s.side));
      }

      // 매 틱마다 DOM을 다시 쓰지 않도록, 바뀐 경우에만 갱신
      const key = [this.idx, s.name, s.side, s.memo, clockText, state, this.running, pausedMid,
        this.topic, this.steps.length, this.totalRemainingSec()].join('|');
      if (key === this.lastRender) return;
      this.lastRender = key;

      const stage = $('#stage');
      stage.dataset.side = s.side;
      stage.classList.toggle('warn', warn);
      stage.classList.toggle('over', over);
      stage.classList.toggle('running', this.running);
      stage.classList.toggle('paused', pausedMid);

      $('#side-badge').textContent = SIDE_BADGE[s.side];
      $('#step-count').textContent = (this.idx + 1) + ' / ' + this.steps.length;
      $('#step-name').textContent = s.name || '(이름 없음)';
      $('#clock').textContent = clockText;
      $('#clock').setAttribute('aria-label', over ? '시간 초과 ' + fmt(remSec) : '남은 시간 ' + fmt(remSec));

      const stateBox = $('#clock-state');
      stateBox.textContent = '';
      const pill = over ? '⚠ 시간 초과' : warn ? '⚠ 곧 종료 · ' + WARN_SEC + '초 이하' : pausedMid ? '일시정지' : '';
      if (pill) stateBox.appendChild(el('span', { class: 'state-pill', text: pill }));

      const memo = $('#step-memo');
      memo.hidden = !s.memo;
      memo.textContent = s.memo;

      $('#topic-line').hidden = !this.topic;
      $('#topic-text').textContent = this.topic;

      const toggle = $('#btn-toggle');
      toggle.textContent = this.running ? '❚❚ 일시정지' : started ? '▶ 계속' : '▶ 시작';
      $('#btn-prev').disabled = this.idx === 0;
      $('#btn-next').disabled = this.idx === this.steps.length - 1;
      $('#total-left').textContent = fmt(this.totalRemainingSec());
    },

    /* ----- 구성 설정 (오버레이 패널) ----- */
    showConfig(show) {
      const overlay = $('#timer-config');
      if (show === !overlay.hidden) return;
      overlay.hidden = !show;
      document.body.classList.toggle('modal-open', show);
      if (show) {
        $('#topic-input').value = this.topic;
        this.renderConfigTable();
        this.renderPresets();
        $('.overlay-panel', overlay).scrollTop = 0;
        $('#topic-input').focus();
      } else {
        this.renderStepbar();
        this.render();
        $('#btn-open-config').focus();
      }
    },
    configOpen() { return !$('#timer-config').hidden; },

    renderConfigTable() {
      const body = $('#step-rows');
      body.textContent = '';
      const last = this.steps.length - 1;
      this.steps.forEach((s, i) => {
        const m = Math.floor(s.sec / 60), sec = s.sec % 60;
        body.appendChild(el('tr', { dataset: { id: s.id }, class: i === this.idx ? 'is-current' : null }, [
          el('td', { class: 'no', text: String(i + 1), title: i === this.idx ? '현재 진행 중인 단계' : null }),
          el('td', null, [el('input', {
            type: 'text', class: 'input', value: s.name, maxlength: '60',
            dataset: { field: 'name' }, 'aria-label': (i + 1) + '단계 이름'
          })]),
          el('td', null, [el('div', { class: 'side-select', role: 'group', 'aria-label': '발언 측' },
            SIDES.map(side => el('button', {
              type: 'button', dataset: { side, act: 'side' },
              'aria-pressed': String(s.side === side), text: SIDE_LABEL[side]
            })))]),
          el('td', null, [el('div', { class: 'time-inputs' }, [
            el('input', { type: 'number', class: 'input', min: '0', max: '99', value: String(m), dataset: { field: 'min' }, 'aria-label': '분' }),
            el('span', { text: '분' }),
            el('input', { type: 'number', class: 'input', min: '0', max: '59', value: String(sec), dataset: { field: 'sec' }, 'aria-label': '초' }),
            el('span', { text: '초' })
          ])]),
          el('td', null, [el('input', {
            type: 'text', class: 'input', value: s.memo, maxlength: '200', placeholder: '진행 화면에 표시할 안내',
            dataset: { field: 'memo' }, 'aria-label': (i + 1) + '단계 메모'
          })]),
          el('td', null, [el('div', { class: 'acts' }, [
            el('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'up' }, disabled: i === 0, title: '위로', 'aria-label': '위로 이동', text: '▲' }),
            el('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'down' }, disabled: i === last, title: '아래로', 'aria-label': '아래로 이동', text: '▼' }),
            el('button', { type: 'button', class: 'btn btn-sm', dataset: { act: 'dup' }, title: '복제', text: '복제' }),
            el('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', dataset: { act: 'del' }, disabled: this.steps.length <= 1, title: '삭제', text: '삭제' })
          ])])
        ]));
      });
      this.renderConfigSummary();
    },
    renderConfigSummary() {
      const total = this.steps.reduce((a, s) => a + s.sec, 0);
      $('#config-total').textContent = fmtKo(total);
      $('#config-count').textContent = String(this.steps.length);
    },

    onConfigInput(e) {
      const input = e.target;
      const row = input.closest('tr');
      if (!row || !input.dataset.field) return;
      const step = this.steps.find(s => s.id === row.dataset.id);
      if (!step) return;
      const f = input.dataset.field;
      if (f === 'name' || f === 'memo') {
        step[f] = input.value;
      } else {
        const m = parseInt($('[data-field="min"]', row).value, 10) || 0;
        const s = parseInt($('[data-field="sec"]', row).value, 10) || 0;
        step.sec = Math.min(MAX_STEP_SEC, Math.max(MIN_STEP_SEC, Math.max(0, m) * 60 + Math.max(0, s)));
      }
      this.stepsChanged();
    },
    // 입력을 마치면 시간 칸을 정규화 (예: 90초 → 1분 30초)
    onConfigChange(e) {
      const input = e.target;
      if (input.dataset.field !== 'min' && input.dataset.field !== 'sec') return;
      const row = input.closest('tr');
      const step = this.steps.find(s => s.id === row.dataset.id);
      if (!step) return;
      $('[data-field="min"]', row).value = String(Math.floor(step.sec / 60));
      $('[data-field="sec"]', row).value = String(step.sec % 60);
    },
    onConfigClick(e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const row = btn.closest('tr');
      const i = this.steps.findIndex(s => s.id === row.dataset.id);
      if (i < 0) return;
      const act = btn.dataset.act;
      let focusAfter = null;
      if (act === 'side') {
        this.steps[i].side = btn.dataset.side;
        focusAfter = [this.steps[i].id, '[data-side="' + btn.dataset.side + '"]'];
      } else if (act === 'up' && i > 0) {
        [this.steps[i - 1], this.steps[i]] = [this.steps[i], this.steps[i - 1]];
        focusAfter = [this.steps[i - 1].id, '[data-act="up"]'];
      } else if (act === 'down' && i < this.steps.length - 1) {
        [this.steps[i + 1], this.steps[i]] = [this.steps[i], this.steps[i + 1]];
        focusAfter = [this.steps[i + 1].id, '[data-act="down"]'];
      } else if (act === 'dup') {
        const copy = Object.assign({}, this.steps[i], { id: uid() });
        this.steps.splice(i + 1, 0, copy);
        focusAfter = [copy.id, '[data-field="name"]'];
      } else if (act === 'del' && this.steps.length > 1) {
        this.steps.splice(i, 1);
        const neighbor = this.steps[Math.min(i, this.steps.length - 1)];
        focusAfter = [neighbor.id, '[data-field="name"]'];
      } else {
        return;
      }
      this.stepsChanged();
      this.renderConfigTable();
      // 순서 이동 버튼을 연달아 누를 수 있도록 포커스 유지
      if (focusAfter) {
        const row2 = $('#step-rows tr[data-id="' + focusAfter[0] + '"]');
        const target = row2 && $(focusAfter[1], row2);
        if (target && !target.disabled) target.focus();
      }
    },
    addStep() {
      const step = { id: uid(), name: '새 단계', side: 'all', sec: 60, memo: '' };
      this.steps.push(step);
      this.stepsChanged();
      this.renderConfigTable();
      const input = $('#step-rows tr[data-id="' + step.id + '"] [data-field="name"]');
      if (input) { input.focus(); input.select(); }
    },

    /* ----- 저장된 구성 ----- */
    renderPresets() {
      const list = $('#preset-list');
      list.textContent = '';
      if (!this.presets.length) {
        list.appendChild(el('li', { class: 'empty', text: '저장된 구성이 없습니다.' }));
        return;
      }
      this.presets.forEach(p => {
        const total = p.steps.reduce((a, s) => a + (Number(s.sec) || 0), 0);
        list.appendChild(el('li', null, [
          el('span', { class: 'saved-name', text: p.name }),
          el('span', { class: 'saved-meta', text: p.steps.length + '단계 · ' + fmtKo(total) }),
          el('button', { type: 'button', class: 'btn btn-sm', text: '불러오기', onclick: () => this.loadPreset(p.id) }),
          el('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', text: '삭제', onclick: () => this.deletePreset(p.id) })
        ]));
      });
    },
    savePreset() {
      const input = $('#preset-name');
      const name = input.value.trim();
      if (!name) { toast('구성 이름을 입력해 주세요.'); input.focus(); return; }
      const data = this.steps.map(({ name, side, sec, memo }) => ({ name, side, sec, memo }));
      const existing = this.presets.find(p => p.name === name);
      if (existing) {
        if (!window.confirm('“' + name + '” 구성을 현재 내용으로 덮어쓸까요?')) return;
        existing.steps = data;
      } else {
        this.presets.push({ id: uid(), name, steps: data });
      }
      store.set('presets', this.presets);
      input.value = '';
      this.renderPresets();
      toast('“' + name + '” 구성을 저장했습니다.');
    },
    loadPreset(id) {
      const p = this.presets.find(x => x.id === id);
      const steps = p && sanitizeSteps(p.steps.map(s => Object.assign({}, s, { id: uid() })));
      if (!steps) return;
      this.replaceSteps(steps);
      toast('“' + p.name + '” 구성을 불러왔습니다.');
    },
    deletePreset(id) {
      const p = this.presets.find(x => x.id === id);
      if (!p || !window.confirm('“' + p.name + '” 구성을 삭제할까요?')) return;
      this.presets = this.presets.filter(x => x.id !== id);
      store.set('presets', this.presets);
      this.renderPresets();
    },

    /* ----- 초기화 ----- */
    init() {
      this.curId = this.steps[0].id;

      $('#btn-toggle').addEventListener('click', () => this.toggle());
      $('#btn-next').addEventListener('click', () => this.next());
      $('#btn-prev').addEventListener('click', () => this.prev());
      $('#btn-reset').addEventListener('click', () => this.resetCurrent());

      const soundBox = $('#opt-sound');
      soundBox.checked = this.sound;
      soundBox.addEventListener('change', () => {
        this.sound = soundBox.checked;
        store.set('sound', this.sound);
        if (this.sound) Sound.test();
      });
      const autoBox = $('#opt-auto');
      autoBox.checked = this.auto;
      autoBox.addEventListener('change', () => {
        this.auto = autoBox.checked;
        store.set('auto', this.auto);
      });

      $('#btn-open-config').addEventListener('click', () => this.showConfig(true));
      $('#btn-close-config').addEventListener('click', () => this.showConfig(false));
      // 패널 바깥(어두운 배경)을 누르거나 Esc로 닫기
      $('#timer-config').addEventListener('click', e => { if (e.target.id === 'timer-config') this.showConfig(false); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.configOpen()) this.showConfig(false); });
      $('#topic-input').addEventListener('input', e => {
        this.topic = e.target.value.trim();
        store.set('topic', this.topic);
        this.render();
      });
      const rows = $('#step-rows');
      rows.addEventListener('input', e => this.onConfigInput(e));
      rows.addEventListener('change', e => this.onConfigChange(e));
      rows.addEventListener('click', e => this.onConfigClick(e));
      $('#btn-add-step').addEventListener('click', () => this.addStep());
      $('#btn-save-preset').addEventListener('click', () => this.savePreset());
      $('#preset-name').addEventListener('keydown', e => { if (e.key === 'Enter') this.savePreset(); });
      $('#btn-default-steps').addEventListener('click', () => {
        if (window.confirm('단계 구성을 기본 예시(9단계)로 되돌릴까요? 현재 구성은 사라집니다.')) {
          this.replaceSteps(makeDefaultSteps());
          toast('기본 구성으로 되돌렸습니다.');
        }
      });

      // 키보드 단축키: 진행 화면에서만, 구성 설정이 닫혀 있고 입력 중이 아닐 때
      document.addEventListener('keydown', e => {
        if (Tabs.current !== 'run' || this.configOpen()) return;
        if (e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return;
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();      // 페이지 스크롤과 버튼 클릭 중복 방지
          if (!e.repeat) this.toggle();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); this.next();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); this.prev();
        } else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
          e.preventDefault(); this.resetCurrent();
        }
      });
      // 포커스된 버튼·체크박스 위에서 스페이스를 떼면 클릭이 한 번 더 일어나는 것 방지
      document.addEventListener('keyup', e => {
        if (Tabs.current === 'run' && !this.configOpen() && e.code === 'Space' && isToggleLike(e.target)) {
          e.preventDefault();
        }
      });

      this.ensureTick();
      this.renderStepbar();
      this.render();
    }
  };

  /* =========================================================
     학생 명단 (탭 2에서 입력, 탭 3에서 사용)
     ========================================================= */
  const Roster = {
    text: String(store.get('rosterText', '') || ''),
    saved: (Array.isArray(store.get('rosters', [])) ? store.get('rosters', []) : [])
      .filter(r => r && typeof r.name === 'string' && typeof r.text === 'string')
      .map(r => Object.assign({}, r, { id: typeof r.id === 'string' ? r.id : uid() })),
    listeners: [],

    // 한 줄에 한 명. 빈 줄은 무시하고, 같은 이름은 한 번만
    parse() {
      const seen = new Set();
      let dup = 0;
      const names = [];
      this.text.split(/\r?\n/).forEach(line => {
        const name = line.trim();
        if (!name) return;
        if (seen.has(name)) { dup++; return; }
        seen.add(name);
        names.push(name);
      });
      return { names, dup };
    },
    names() { return this.parse().names; },

    setText(text) {
      this.text = text;
      store.set('rosterText', text);
      this.renderCount();
      this.listeners.forEach(fn => fn());
    },
    onChange(fn) { this.listeners.push(fn); },

    renderCount() {
      const { names, dup } = this.parse();
      const box = $('#roster-count');
      box.textContent = '인식된 학생 ' + names.length + '명';
      if (dup) box.appendChild(el('span', { class: 'warn-note', text: '(중복 이름 ' + dup + '개는 한 번만 셉니다)' }));
    },
    renderSaved() {
      const list = $('#roster-list');
      list.textContent = '';
      if (!this.saved.length) {
        list.appendChild(el('li', { class: 'empty', text: '저장된 명단이 없습니다. 분반별로 이름을 붙여 저장해 두세요.' }));
        return;
      }
      this.saved.forEach(r => {
        const count = r.text.split(/\r?\n/).filter(l => l.trim()).length;
        list.appendChild(el('li', null, [
          el('span', { class: 'saved-name', text: r.name }),
          el('span', { class: 'saved-meta', text: count + '명' }),
          el('button', { type: 'button', class: 'btn btn-sm', text: '불러오기', onclick: () => this.load(r.id) }),
          el('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost', text: '삭제', onclick: () => this.remove(r.id) })
        ]));
      });
    },
    save() {
      const input = $('#roster-name');
      const name = input.value.trim();
      if (!this.names().length) { toast('저장할 명단이 비어 있습니다.'); return; }
      if (!name) { toast('명단 이름을 입력해 주세요. (예: 화요일 1분반)'); input.focus(); return; }
      const existing = this.saved.find(r => r.name === name);
      if (existing) {
        if (!window.confirm('“' + name + '” 명단을 현재 내용으로 덮어쓸까요?')) return;
        existing.text = this.text;
      } else {
        this.saved.push({ id: uid(), name, text: this.text });
      }
      store.set('rosters', this.saved);
      input.value = '';
      this.renderSaved();
      toast('“' + name + '” 명단을 저장했습니다.');
    },
    load(id) {
      const r = this.saved.find(x => x.id === id);
      if (!r) return;
      $('#roster-input').value = r.text;
      this.setText(r.text);
      toast('“' + r.name + '” 명단을 불러왔습니다.');
    },
    remove(id) {
      const r = this.saved.find(x => x.id === id);
      if (!r || !window.confirm('“' + r.name + '” 명단을 삭제할까요?')) return;
      this.saved = this.saved.filter(x => x.id !== id);
      store.set('rosters', this.saved);
      this.renderSaved();
    },
    init() {
      const area = $('#roster-input');
      area.value = this.text;
      area.addEventListener('input', () => this.setText(area.value));
      $('#btn-save-roster').addEventListener('click', () => this.save());
      $('#roster-name').addEventListener('keydown', e => { if (e.key === 'Enter') this.save(); });
      this.renderCount();
      this.renderSaved();
    }
  };

  /* =========================================================
     탭 2. 모둠·역할 배정
     ========================================================= */
  const DEFAULT_ROLES = ['사회자', '기록자', '시간지킴이', '팩트체커', '발표자'];
  const EXTRA_ROLE = '토론자';
  const REVEAL_GAP = 650;   // 카드 한 장씩 공개되는 간격(ms)

  // 이전 버전 설정({sides: true/false})을 새 진영 설정으로 변환
  function loadGroupOpts() {
    const raw = store.get('groupOpts', {});
    const saved = raw && typeof raw === 'object' ? raw : {};
    const opts = Object.assign({ mode: 'count', num: 4, roles: true, rolesText: DEFAULT_ROLES.join('\n') }, saved);
    const c = saved.camp && typeof saved.camp === 'object' ? saved.camp : {};
    opts.camp = {
      mode: ['none', 'person', 'group'].includes(c.mode) ? c.mode : (saved.sides === false ? 'none' : 'group'),
      pro: c.pro == null ? '' : String(c.pro),
      con: c.con == null ? '' : String(c.con),
      aud: c.aud == null ? '' : String(c.aud)
    };
    delete opts.sides;
    if (typeof opts.rolesText !== 'string') opts.rolesText = DEFAULT_ROLES.join('\n');
    return opts;
  }
  // 이전 버전 결과(조 단위 side만 있음)를 학생별 진영 형식으로 변환
  function normalizeResult(r) {
    if (!r || !Array.isArray(r.groups) || !r.groups.length) return null;
    let total = 0;
    r.groups.forEach((g, i) => {
      g.no = Number(g.no) || i + 1;
      g.members = (Array.isArray(g.members) ? g.members : []).filter(m => m && typeof m.name === 'string');
      g.members.forEach(m => {
        if (!CAMPS.includes(m.side)) m.side = CAMPS.includes(g.side) ? g.side : null;
        if (typeof m.role !== 'string') m.role = null;
      });
      g.missing = Array.isArray(g.missing) ? g.missing.filter(x => typeof x === 'string') : [];
      delete g.side;
      total += g.members.length;
    });
    if (!['none', 'person', 'group'].includes(r.campMode)) {
      r.campMode = r.groups.some(g => g.members.some(m => m.side)) ? 'group' : 'none';
    }
    // 역할 목록: 저장돼 있지 않으면(이전 버전) 배정된 순서대로 복원
    if (!Array.isArray(r.roles)) {
      const seen = [];
      r.groups.forEach(g => {
        g.members.forEach(m => { if (m.role && m.role !== EXTRA_ROLE && !seen.includes(m.role)) seen.push(m.role); });
        g.missing.forEach(x => { if (!seen.includes(x)) seen.push(x); });
      });
      r.roles = seen;
    }
    r.roles = r.roles.filter(x => typeof x === 'string');
    if (typeof r.rolesOn !== 'boolean') r.rolesOn = r.groups.some(g => g.members.some(m => m.role));
    // 청중에게는 역할이 없다 (이전 결과에 남아 있던 역할 정리)
    r.groups.forEach(g => g.members.forEach(m => { if (m.side === 'aud') m.role = null; }));
    r.total = total;
    return r;
  }

  const Groups = {
    opts: loadGroupOpts(),
    result: normalizeResult(store.get('groupResult', null)),
    revealTimers: [],
    listeners: [],

    saveOpts() { store.set('groupOpts', this.opts); },
    saveResult() {
      store.set('groupResult', this.result);
      this.listeners.forEach(fn => fn());
    },
    onChange(fn) { this.listeners.push(fn); },
    roleList() { return this.opts.rolesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean); },

    // 이름 → 진영 (가장 최근 편성 결과 기준)
    campMap() {
      const map = {};
      if (this.result) this.result.groups.forEach(g => g.members.forEach(m => { if (m.side) map[m.name] = m.side; }));
      return map;
    },
    // 조 전체가 같은 진영이면 그 진영, 아니면 null
    groupSide(g) {
      const s = g.members.length ? g.members[0].side : null;
      return s && g.members.every(m => m.side === s) ? s : null;
    },

    /* ----- 진영 인원 계산 -----
       입력한 만큼 찬성·반대·청중을 배정하고, 입력하지 않은 나머지는 청중.
       셋 다 비우면 찬성·반대를 반반으로(홀수면 남는 1은 무작위). */
    campPlan(total) {
      const c = this.opts.camp;
      const val = k => (c[k] === '' || c[k] == null) ? null : Math.max(0, parseInt(c[k], 10) || 0);
      const raw = { pro: val('pro'), con: val('con'), aud: val('aud') };
      if (raw.pro === null && raw.con === null && raw.aud === null) {
        const half = Math.floor(total / 2);
        return { pro: half, con: half, aud: 0, extra: total % 2, auto: true, over: false };
      }
      const pro = Math.min(raw.pro || 0, total);
      const con = Math.min(raw.con || 0, total - pro);
      const asked = (raw.pro || 0) + (raw.con || 0) + (raw.aud || 0);
      return { pro, con, aud: total - pro - con, extra: 0, auto: false, over: asked > total };
    },
    // total개 단위에 진영을 무작위로 나눠 준 배열
    allocate(total) {
      const p = this.campPlan(total);
      const list = [];
      for (let i = 0; i < p.pro; i++) list.push('pro');
      for (let i = 0; i < p.con; i++) list.push('con');
      for (let i = 0; i < p.aud; i++) list.push('aud');
      if (p.extra) list.push(Math.random() < 0.5 ? 'pro' : 'con');
      return shuffle(list);
    },
    renderCampPreview() {
      const c = this.opts.camp;
      const off = c.mode === 'none';
      $('#camp-inputs').hidden = off;
      const unit = c.mode === 'group' ? '개 조' : '명';
      $$('.camp-unit').forEach(u => { u.textContent = unit; });
      ['pro', 'con', 'aud'].forEach(k => { $('#camp-' + k).value = c[k]; });
      const box = $('#camp-preview');
      if (off) { box.textContent = '진영 없이 조만 편성합니다. 결과에서 이름을 눌러 직접 진영을 정할 수도 있습니다.'; return; }
      const n = Roster.names().length;
      if (n < 2) { box.textContent = '학생을 2명 이상 입력하면 진영 배정을 미리 알려 드립니다.'; return; }
      const total = c.mode === 'group' ? this.groupCount(n) : n;
      const p = this.campPlan(total);
      let text = (c.mode === 'group' ? total + '개 조' : total + '명') + ' → 찬성 ' + p.pro + ' · 반대 ' + p.con + ' · 청중 ' + p.aud;
      if (p.extra) text += ' (남는 ' + p.extra + unit + '는 찬성·반대 중 무작위)';
      if (p.auto) text += ' — 칸을 모두 비워 두어 찬성·반대를 반반으로 나눕니다.';
      if (p.over) text += ' — 입력 합계가 ' + total + unit + '보다 많아 반대·청중 순으로 줄였습니다.';
      box.textContent = text;
    },

    // 학생 수와 설정으로 조 개수 계산
    groupCount(n) {
      const num = Math.max(1, parseInt(this.opts.num, 10) || 1);
      if (this.opts.mode === 'size') return Math.max(1, Math.ceil(n / num));
      return Math.min(num, n);
    },
    // 섞은 순서대로 돌아가며 넣으면 조별 인원 차이는 최대 1명
    sizesFor(n, k) {
      return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
    },

    renderPreview() {
      const n = Roster.names().length;
      $('#group-num-unit').textContent = this.opts.mode === 'size' ? '명씩' : '개 조';
      const box = $('#group-preview');
      if (n < 2) { box.textContent = '학생을 2명 이상 입력하면 편성 결과를 미리 알려 드립니다.'; return; }
      const k = this.groupCount(n);
      const sizes = this.sizesFor(n, k);
      const big = sizes[0], small = sizes[sizes.length - 1];
      let desc;
      if (big === small) desc = big + '명씩';
      else {
        const nb = sizes.filter(s => s === big).length;
        desc = big + '명 ' + nb + '개 조, ' + small + '명 ' + (k - nb) + '개 조';
      }
      box.textContent = n + '명 → ' + k + '개 조 (' + desc + ')';
      this.renderCampPreview();
    },

    draw() {
      const names = Roster.names();
      if (names.length < 2) {
        toast('학생 명단을 2명 이상 입력해 주세요.');
        $('#roster-input').focus();
        return;
      }
      const k = this.groupCount(names.length);
      const buckets = Array.from({ length: k }, () => []);
      shuffle(names).forEach((name, i) => buckets[i % k].push(name));

      // 진영: 조 단위면 조마다, 개인 단위면 학생마다
      const campMode = this.opts.camp.mode;
      const groupSides = campMode === 'group' ? this.allocate(k) : null;
      const personSide = {};
      if (campMode === 'person') {
        const sides = this.allocate(names.length);
        shuffle(names).forEach((name, i) => { personSide[name] = sides[i]; });
      }

      const rolesOn = this.opts.roles;
      const roles = rolesOn ? this.roleList() : [];
      const groups = buckets.map((members, i) => {
        const g = {
          no: i + 1,
          members: shuffle(members).map(name => ({
            name,
            role: null,
            side: groupSides ? groupSides[i] : (personSide[name] || null)
          }))
        };
        this.assignRoles(g, roles, rolesOn);
        return g;
      });
      this.result = { groups, total: names.length, campMode, rolesOn, roles, at: Date.now() };
      this.saveResult();
      this.showResult(true);
    },

    /* ----- 역할 배정 -----
       청중은 대상에서 제외(진영을 정하지 않은 학생은 대상).
       대상이 역할 수보다 적으면 앞쪽 역할부터, 많으면 남는 학생은 '토론자'. */
    assignRoles(g, roles, rolesOn) {
      g.members.forEach(m => { m.role = null; });
      if (!rolesOn) return;
      shuffle(g.members.filter(m => m.side !== 'aud')).forEach((m, j) => {
        m.role = roles[j] || EXTRA_ROLE;
      });
    },
    // 지금 상태에서 아무도 맡지 않은 역할 (청중만 있는 조는 표시하지 않음)
    missingRoles(g) {
      const r = this.result;
      if (!r.rolesOn || !g.members.some(m => m.side !== 'aud')) return [];
      return r.roles.filter(role => !g.members.some(m => m.role === role));
    },
    // 조·진영은 그대로 두고 역할만 다시 배정
    rerollRoles() {
      if (!this.result) return;
      const rolesOn = this.opts.roles;
      const roles = rolesOn ? this.roleList() : [];
      this.result.rolesOn = rolesOn;
      this.result.roles = roles;
      this.result.groups.forEach(g => this.assignRoles(g, roles, rolesOn));
      this.saveResult();
      this.renderCards(false);
      toast(rolesOn ? '조와 진영은 그대로 두고 역할만 다시 뽑았습니다. (청중 제외)' : '역할 뽑기가 꺼져 있어 역할을 지웠습니다.');
    },

    /* ----- 결과에서 진영 수동 조정 ----- */
    // 청중이 되면 역할을 바로 지운다. 청중에서 찬성/반대가 되면 역할은 비워 두고 다시 뽑을 때 배정.
    cycleMember(gi, mi) {
      const m = this.result.groups[gi].members[mi];
      m.side = nextCamp(m.side);
      if (m.side === 'aud') m.role = null;
      this.saveResult();
      this.refreshCard(gi);
    },
    cycleGroup(gi) {
      const g = this.result.groups[gi];
      const next = nextCamp(this.groupSide(g));
      g.members.forEach(m => {
        m.side = next;
        if (next === 'aud') m.role = null;
      });
      this.saveResult();
      this.refreshCard(gi);
    },
    refreshCard(gi) {
      const card = $$('#group-cards .gcard')[gi];
      if (!card) return;
      const old = $('.gcard-front', card);
      old.replaceWith(this.buildFront(this.result.groups[gi], gi));
    },
    buildFront(g, gi) {
      const side = this.groupSide(g);
      const byGroup = this.result.campMode === 'group';
      const counts = CAMPS.map(c => [c, g.members.filter(m => m.side === c).length]).filter(x => x[1]);
      const missing = this.missingRoles(g);
      // 청중에서 찬성/반대로 바뀌어 역할이 비어 있는 학생이 있는지
      const waiting = this.result.rolesOn && g.members.some(m => m.side !== 'aud' && !m.role);
      let badge = null;
      if (side) {
        badge = el('button', {
          type: 'button', class: 'g-side', dataset: { side },
          title: byGroup ? '눌러서 조 전체 진영 바꾸기 (찬성 → 반대 → 청중)' : '조원 모두 같은 진영',
          text: SIDE_LABEL[side],
          onclick: () => this.cycleGroup(gi)
        });
      } else if (counts.length) {
        badge = el('span', { class: 'g-mix', text: counts.map(x => SIDE_LABEL[x[0]] + ' ' + x[1]).join(' · ') });
      }
      return el('div', { class: 'gcard-face gcard-front', dataset: { side: side || 'none' } }, [
        el('div', { class: 'gcard-head' }, [
          el('span', { class: 'g-no', text: g.no + '조' }),
          badge,
          el('span', { class: 'g-count', text: g.members.length + '명' })
        ]),
        el('ul', { class: 'g-members' }, g.members.map((m, mi) => el('li', null, [
          el('button', {
            type: 'button', class: 'member-btn', dataset: { side: m.side || 'none' },
            title: '눌러서 진영 바꾸기 (찬성 → 반대 → 청중)',
            onclick: () => this.cycleMember(gi, mi)
          }, [
            el('span', { class: 'm-name', text: m.name }),
            el('span', { class: 'camp-chip', text: m.side ? SIDE_LABEL[m.side] : '진영 없음' })
          ]),
          // 청중에게는 역할 항목 자체를 표시하지 않음
          m.role && m.side !== 'aud' ? el('span', { class: 'role-chip' + (m.role === EXTRA_ROLE ? ' plain' : ''), text: m.role }) : null
        ]))),
        missing.length ? el('p', { class: 'g-missing', text: '배정되지 않은 역할: ' + missing.join(', ') +
          (waiting ? ' · ‘역할만 다시 뽑기’로 채울 수 있습니다' : '') }) : null
      ]);
    },

    showResult(animate) {
      $('#groups-setup').hidden = true;
      $('#groups-result').hidden = false;
      this.renderCards(animate);
      window.scrollTo(0, 0);
    },
    showSetup() {
      this.stopReveal();
      $('#groups-result').hidden = true;
      $('#groups-setup').hidden = false;
      $('#btn-show-result').hidden = !this.result;
      this.renderPreview();
    },

    renderCards(animate) {
      this.stopReveal();
      const r = this.result;
      const wrap = $('#group-cards');
      wrap.textContent = '';
      $('#result-title').textContent = '모둠 편성 결과 · ' + r.groups.length + '개 조 · ' + r.total + '명';
      // 마지막 줄에 카드가 한두 장만 남지 않도록 조 수에 맞춰 열 수 결정
      const k = r.groups.length;
      wrap.style.setProperty('--cols', k <= 4 ? k : k <= 6 ? 3 : k <= 8 ? 4 : k <= 10 ? 5 : 6);

      r.groups.forEach((g, gi) => {
        const front = this.buildFront(g, gi);
        const back = el('div', { class: 'gcard-face gcard-back', 'aria-hidden': 'true' }, [
          el('span', { class: 'back-no', text: g.no + '조' }),
          el('span', { class: 'back-hint', text: '눌러서 공개' })
        ]);
        const card = el('div', { class: 'gcard', dataset: { no: String(g.no) } }, [
          el('div', { class: 'gcard-inner' }, [back, front])
        ]);
        back.addEventListener('click', () => this.flip(card));
        wrap.appendChild(card);
      });

      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!animate || reduce) {
        this.revealAll();
        return;
      }
      $('#btn-skip-reveal').disabled = false;
      $$('.gcard', wrap).forEach((card, i) => {
        this.revealTimers.push(setTimeout(() => this.flip(card), 400 + i * REVEAL_GAP));
      });
    },
    flip(card) {
      if (card.classList.contains('flipped')) return;
      card.classList.add('flipped');
      if ($$('#group-cards .gcard:not(.flipped)').length === 0) $('#btn-skip-reveal').disabled = true;
    },
    revealAll() {
      this.stopReveal();
      $$('#group-cards .gcard').forEach(card => card.classList.add('flipped'));
      $('#btn-skip-reveal').disabled = true;
    },
    stopReveal() {
      this.revealTimers.forEach(clearTimeout);
      this.revealTimers = [];
    },

    init() {
      const o = this.opts;
      // 이전 버전 형식으로 저장돼 있었다면 새 형식으로 바로 다시 저장
      this.saveOpts();
      if (this.result) store.set('groupResult', this.result);
      $$('input[name="group-mode"]').forEach(r => {
        r.checked = r.value === o.mode;
        r.addEventListener('change', () => {
          if (!r.checked) return;
          o.mode = r.value;
          this.saveOpts();
          this.renderPreview();
        });
      });
      const num = $('#group-num');
      num.value = o.num;
      num.addEventListener('input', () => {
        o.num = Math.max(1, Math.min(99, parseInt(num.value, 10) || 1));
        this.saveOpts();
        this.renderPreview();
      });
      num.addEventListener('change', () => { num.value = o.num; });

      $$('input[name="camp-mode"]').forEach(r => {
        r.checked = r.value === o.camp.mode;
        r.addEventListener('change', () => {
          if (!r.checked) return;
          o.camp.mode = r.value;
          this.saveOpts();
          this.renderCampPreview();
        });
      });
      ['pro', 'con', 'aud'].forEach(k => {
        const input = $('#camp-' + k);
        input.addEventListener('input', () => {
          o.camp[k] = input.value.trim() === '' ? '' : String(Math.max(0, Math.min(999, parseInt(input.value, 10) || 0)));
          this.saveOpts();
          this.renderCampPreview();
        });
      });
      const roles = $('#opt-roles');
      const rolesArea = $('#roles-input');
      const syncRolesDisabled = () => { rolesArea.disabled = !o.roles; };
      roles.checked = o.roles;
      roles.addEventListener('change', () => { o.roles = roles.checked; this.saveOpts(); syncRolesDisabled(); });
      rolesArea.value = o.rolesText;
      rolesArea.addEventListener('input', () => { o.rolesText = rolesArea.value; this.saveOpts(); });
      syncRolesDisabled();
      $('#btn-default-roles').addEventListener('click', () => {
        rolesArea.value = o.rolesText = DEFAULT_ROLES.join('\n');
        this.saveOpts();
      });

      $('#btn-draw').addEventListener('click', () => this.draw());
      $('#btn-redraw').addEventListener('click', () => this.draw());
      $('#btn-reroll-roles').addEventListener('click', () => this.rerollRoles());
      $('#btn-skip-reveal').addEventListener('click', () => this.revealAll());
      $('#btn-back-setup').addEventListener('click', () => this.showSetup());
      $('#btn-show-result').addEventListener('click', () => this.showResult(false));

      Roster.onChange(() => this.renderPreview());
      this.showSetup();
    }
  };

  /* =========================================================
     탭 3. 발언 기록판
     ========================================================= */
  const UNDO_LIMIT = 100;

  const Speech = {
    records: [],      // 끝난 발언 [{name, start, end}]
    current: null,    // 진행 중인 발언 {name, start}
    undoStack: [],    // 조작 직전 상태 스냅숏
    sort: store.get('speechSort', 'roster') === 'time' ? 'time' : 'roster',
    filter: ['all', ...CAMPS].includes(store.get('speechFilter', 'all')) ? store.get('speechFilter', 'all') : 'all',
    view: store.get('speechView', 'grid') === 'chart' ? 'chart' : 'grid',
    linkOn: store.get('speechLink', true) !== false,   // 타이머 발언 측 강조 연동
    nodes: {},        // 이름별 버튼·막대 DOM (매 틱마다 다시 만들지 않기 위해 보관)
    campNodes: {},    // 진영별 요약 막대 DOM
    builtFor: '',

    load() {
      const saved = store.get('speech', null);
      if (saved && Array.isArray(saved.records)) {
        this.records = saved.records.filter(r => r && typeof r.name === 'string' && r.end >= r.start);
        const c = saved.current;
        this.current = c && typeof c.name === 'string' && typeof c.start === 'number' ? c : null;
      }
    },
    save() { store.set('speech', { records: this.records, current: this.current }); },

    snapshot() {
      this.undoStack.push(JSON.stringify({ records: this.records, current: this.current }));
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    },
    // 진행 중인 발언을 끝내고 기록으로 남김
    closeCurrent(now) {
      if (!this.current) return;
      this.records.push({ name: this.current.name, start: this.current.start, end: now });
      this.current = null;
    },

    /* ----- 조작 ----- */
    select(name) {
      const now = Date.now();
      this.snapshot();
      if (this.current && this.current.name === name) {
        this.closeCurrent(now);            // 발언 중인 학생을 다시 누르면 정지
      } else {
        this.closeCurrent(now);
        this.current = { name, start: now };
      }
      this.changed();
    },
    stop() {
      if (!this.current) return;
      this.snapshot();
      this.closeCurrent(Date.now());
      this.changed();
    },
    undo() {
      const prev = this.undoStack.pop();
      if (!prev) return;
      const s = JSON.parse(prev);
      this.records = s.records;
      this.current = s.current;
      this.changed();
      toast('직전 기록을 되돌렸습니다.');
    },
    reset() {
      if (!this.records.length && !this.current) return;
      if (!window.confirm('모든 발언 기록을 지울까요? (‘직전 기록 되돌리기’로 복구할 수 있습니다)')) return;
      this.snapshot();
      this.records = [];
      this.current = null;
      this.changed();
    },
    changed() {
      this.save();
      this.update();
    },

    /* ----- 통계 ----- */
    stats(names) {
      const now = Date.now();
      const map = {};
      names.forEach(n => { map[n] = { count: 0, ms: 0 }; });
      this.records.forEach(r => {
        if (map[r.name]) { map[r.name].count++; map[r.name].ms += r.end - r.start; }
      });
      if (this.current && map[this.current.name]) {
        map[this.current.name].count++;
        map[this.current.name].ms += Math.max(0, now - this.current.start);
      }
      return map;
    },

    /* ----- 렌더링 ----- */
    // 명단이 바뀌었을 때만 버튼과 막대를 새로 만든다
    build() {
      const names = Roster.names();
      const key = names.join('\n');
      const empty = names.length === 0;
      $('#speech-empty').hidden = !empty;
      $('#speech-main').hidden = empty;
      if (key === this.builtFor) return;
      this.builtFor = key;

      const grid = $('#name-grid');
      const chart = $('#speech-chart');
      grid.textContent = '';
      chart.textContent = '';
      this.nodes = {};
      this.orderKey = '';
      names.forEach(name => {
        const meta = el('span', { class: 'nb-meta' });
        const tag = el('span', { class: 'nb-camp' });
        const mini = el('i');
        const btn = el('button', { type: 'button', class: 'name-btn', dataset: { name, side: 'none' } }, [
          tag,
          el('span', { class: 'nb-name', text: name }),
          meta,
          el('span', { class: 'nb-bar', 'aria-hidden': 'true' }, [mini])
        ]);
        grid.appendChild(btn);

        const fill = el('div', { class: 'bar-fill' });
        const val = el('span', { class: 'bar-val' });
        const rowTag = el('span', { class: 'bar-camp' });
        const row = el('div', { class: 'bar-row', role: 'listitem', dataset: { side: 'none' } }, [
          rowTag,
          el('span', { class: 'bar-name', text: name }),
          el('div', { class: 'bar-track' }, [fill]),
          val
        ]);
        chart.appendChild(row);
        this.nodes[name] = { btn, meta, tag, mini, row, rowTag, fill, val };
      });
    },

    // 진영별 요약 막대 (찬성/반대/청중 + 미배정 학생이 있으면 미배정)
    renderCampSummary(names, st, camps) {
      const box = $('#camp-summary');
      const keys = CAMPS.slice();
      if (names.some(n => !camps[n])) keys.push('none');
      const totals = {};
      keys.forEach(k => { totals[k] = { ms: 0, count: 0, people: 0 }; });
      names.forEach(n => {
        const t = totals[camps[n] || 'none'];
        t.ms += st[n].ms; t.count += st[n].count; t.people++;
      });
      const keyStr = keys.join(',');
      if (box.dataset.keys !== keyStr) {
        box.dataset.keys = keyStr;
        box.textContent = '';
        this.campNodes = {};
        keys.forEach(k => {
          const fill = el('div', { class: 'camp-fill' });
          const val = el('span', { class: 'camp-val' });
          const label = el('span', { class: 'camp-chip', text: SIDE_LABEL[k] });
          const row = el('div', { class: 'camp-row', dataset: { side: k } }, [
            label, el('div', { class: 'camp-track' }, [fill]), val
          ]);
          box.appendChild(row);
          this.campNodes[k] = { row, fill, val, label };
        });
      }
      const max = Math.max(1, ...keys.map(k => totals[k].ms));
      keys.forEach(k => {
        const t = totals[k], nd = this.campNodes[k];
        nd.fill.style.width = (t.ms / max * 100).toFixed(2) + '%';
        nd.val.textContent = t.count + '회 · ' + fmt(Math.floor(t.ms / 1000));
        nd.label.textContent = SIDE_LABEL[k] + ' ' + t.people + '명';
        nd.row.title = SIDE_LABEL[k] + ' ' + t.people + '명: 발언 ' + t.count + '회, 누적 ' + fmt(Math.floor(t.ms / 1000));
      });
    },

    update() {
      this.build();
      const names = Roster.names();
      if (!names.length) return;
      const st = this.stats(names);
      const camps = Groups.campMap();
      const curName = this.current && st[this.current.name] ? this.current.name : null;
      const maxMs = Math.max(1, ...names.map(n => st[n].ms));
      let spoken = 0;
      // 타이머 현재 단계의 발언 측 학생만 강조 ('전체'이거나 연동을 끄면 모두 같게)
      const stepSide = Timer.step.side;
      const focus = this.linkOn ? stepSide : 'all';
      const note = $('#link-note');
      note.dataset.side = focus === 'all' ? 'all' : focus;
      note.textContent = !this.linkOn ? '' : focus === 'all' ? '전체 단계 · 모두 표시' : SIDE_LABEL[focus] + ' 학생 강조 중';
      note.hidden = !this.linkOn;

      names.forEach(name => {
        const s = st[name];
        const nd = this.nodes[name];
        const side = camps[name] || 'none';
        const speaking = name === curName;
        const unspoken = s.count === 0;
        if (!unspoken) spoken++;
        const timeText = fmt(Math.floor(s.ms / 1000));
        const summary = unspoken ? '발언 없음' : s.count + '회 · ' + timeText;
        const shown = this.filter === 'all' || side === this.filter;

        nd.btn.dataset.side = side;
        nd.row.dataset.side = side;
        nd.tag.textContent = SIDE_LABEL[side];
        nd.rowTag.textContent = SIDE_LABEL[side];
        nd.btn.hidden = !shown;
        nd.row.hidden = !shown;
        nd.mini.style.width = (s.ms / maxMs * 100).toFixed(2) + '%';
        const match = focus === 'all' || side === focus;
        nd.btn.classList.toggle('focus', focus !== 'all' && match);
        nd.btn.classList.toggle('dim', !match && !speaking);
        nd.btn.classList.toggle('speaking', speaking);
        nd.btn.classList.toggle('unspoken', unspoken && !speaking);
        nd.btn.setAttribute('aria-pressed', String(speaking));
        nd.meta.textContent = speaking ? '발언 중' : unspoken ? '아직 발언 안 함' : summary;
        nd.btn.title = speaking ? '다시 누르면 발언 정지' : name + ' 발언 시작';

        nd.row.classList.toggle('speaking', speaking);
        nd.row.classList.toggle('unspoken', unspoken);
        nd.fill.style.width = (s.ms / maxMs * 100).toFixed(2) + '%';
        nd.val.textContent = summary;
        nd.row.title = name + ': ' + (unspoken ? '아직 발언하지 않음' : s.count + '회, 누적 ' + timeText);
      });

      // 정렬 (기존 노드를 옮기기만 함)
      const order = names.slice();
      if (this.sort === 'time') order.sort((a, b) => st[b].ms - st[a].ms || st[b].count - st[a].count);
      const orderKey = order.join('\n');
      if (orderKey !== this.orderKey) {
        this.orderKey = orderKey;
        const chart = $('#speech-chart');
        order.forEach(n => chart.appendChild(this.nodes[n].row));
      }

      // 현재 발언자
      const box = $('#now-speaking');
      box.classList.toggle('active', !!curName);
      $('#now-name').textContent = curName || '발언자 없음';
      $('#now-time').textContent = curName ? fmt(Math.floor(Math.max(0, Date.now() - this.current.start) / 1000)) : '00:00';

      const left = names.length - spoken;
      const sum = $('#speech-summary');
      sum.textContent = '발언 ' + spoken + ' / ' + names.length + '명';
      sum.title = '발언한 학생 ' + spoken + '명, 아직 발언하지 않은 학생 ' + left + '명';
      if (left) {
        sum.appendChild(document.createTextNode(' · '));
        sum.appendChild(el('span', { class: 'hl', text: '미발언 ' + left + '명' }));
      } else {
        sum.appendChild(document.createTextNode(' · 모두 발언'));
      }

      this.renderCampSummary(names, st, camps);

      $('#btn-speech-stop').disabled = !this.current;
      $('#btn-speech-undo').disabled = !this.undoStack.length;
      $('#btn-speech-reset').disabled = !this.records.length && !this.current;
      $$('.seg-btn[data-sort]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === this.sort)));
      $$('.seg-btn[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === this.filter)));
      $$('.seg-btn[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === this.view)));
      $('#name-grid').hidden = this.view !== 'grid';
      $('#speech-chart').hidden = this.view !== 'chart';
      $('#sort-seg').hidden = this.view !== 'chart';
      $('#opt-link').checked = this.linkOn;
    },

    init() {
      this.load();
      $('#name-grid').addEventListener('click', e => {
        const btn = e.target.closest('.name-btn');
        if (btn) this.select(btn.dataset.name);
      });
      $('#btn-speech-stop').addEventListener('click', () => this.stop());
      $('#btn-speech-undo').addEventListener('click', () => this.undo());
      $('#btn-speech-reset').addEventListener('click', () => this.reset());
      $$('.seg-btn[data-sort]').forEach(b => b.addEventListener('click', () => {
        this.sort = b.dataset.sort;
        store.set('speechSort', this.sort);
        this.update();
      }));
      $$('.seg-btn[data-filter]').forEach(b => b.addEventListener('click', () => {
        this.filter = b.dataset.filter;
        store.set('speechFilter', this.filter);
        this.update();
      }));
      $$('.seg-btn[data-view]').forEach(b => b.addEventListener('click', () => {
        this.view = b.dataset.view;
        store.set('speechView', this.view);
        this.update();
      }));
      $('#opt-link').addEventListener('change', e => {
        this.linkOn = e.target.checked;
        store.set('speechLink', this.linkOn);
        this.update();
      });
      Groups.onChange(() => this.update());
      Timer.sideListeners.push(() => this.update());
      $('#btn-goto-roster').addEventListener('click', () => {
        Tabs.show('groups');
        Groups.showSetup();
        $('#roster-input').focus();
      });

      Roster.onChange(() => { if (Tabs.current === 'run') this.update(); });
      Tabs.onChange(name => { if (name === 'run') this.update(); });
      // 발언 중일 때만 화면의 시간·막대를 갱신
      setInterval(() => {
        if (this.current && Tabs.current === 'run') this.update();
      }, 250);
      this.update();
    }
  };

  /* ---------------------------------------------------------
     시작
     --------------------------------------------------------- */
  // 첫 사용자 조작에서 오디오를 깨워 두면 0초 알림이 바로 울린다
  const unlockAudio = () => { if (Timer.sound) Sound.unlock(); };
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  // 상단 바 실제 높이를 CSS 변수로 넘겨 진행 화면이 정확히 한 화면에 맞도록
  const topbar = $('.topbar');
  const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
  syncTopbar();
  if (window.ResizeObserver) new ResizeObserver(syncTopbar).observe(topbar);
  else window.addEventListener('resize', syncTopbar);

  Theme.init();
  Timer.init();
  Roster.init();
  Groups.init();
  Speech.init();
  Tabs.init();
})();
