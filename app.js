/* ==========================================================================
   데일리툴 — app.js
   모든 계산은 브라우저 안에서만 이루어집니다. 외부 요청 없음.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var nf0 = new Intl.NumberFormat('ko-KR');
  var nf2 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

  function fmt(n) { return isFinite(n) ? nf0.format(Math.round(n)) : '—'; }
  function fmt2(n) { return isFinite(n) ? nf2.format(n) : '—'; }
  function won(n) { return isFinite(n) ? fmt(n) + '원' : '—'; }

  function shortKrw(n) {
    if (!isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 100000000) return fmt2(n / 100000000) + '억원';
    if (a >= 10000) return fmt2(n / 10000) + '만원';
    return won(n);
  }

  function parseNum(v) {
    var cleaned = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
    var n = Number(cleaned);
    return isFinite(n) ? n : 0;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function floor10(n) {
    /* 10원 미만 버림. 부동소수 오차(27000 → 26999.999…)로 1원이 깎이지 않도록 epsilon */
    return Math.floor(n / 10 + 1e-9) * 10;
  }

  /* 숫자 입력: 천 단위 콤마 + 커서 위치 유지 */
  function sanitizeNumeric(el, allowDecimal) {
    var raw = el.value || '';
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var head = raw.slice(0, caret);
    var digitsBefore = (head.replace(/[^0-9]/g, '')).length;

    var allowed = raw.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
    if (allowDecimal) {
      var firstDot = allowed.indexOf('.');
      if (firstDot !== -1) {
        allowed = allowed.slice(0, firstDot + 1) +
          allowed.slice(firstDot + 1).replace(/\./g, '');
      }
    }

    var parts = allowed.split('.');
    var intPart = parts[0].replace(/^0+(?=\d)/, '');
    var out = intPart ? nf0.format(Number(intPart)) : '';
    if (allowDecimal && parts.length > 1) {
      out += '.' + parts[1].slice(0, 3);
    }
    el.value = out;

    /* 커서 복원 */
    var pos = 0, seen = 0;
    while (pos < out.length && seen < digitsBefore) {
      if (/[0-9]/.test(out.charAt(pos))) seen++;
      pos++;
    }
    try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
  }

  function attachNumericInputs() {
    $$('input[data-int]').forEach(function (el) {
      el.addEventListener('input', function () { sanitizeNumeric(el, false); });
      sanitizeNumeric(el, false);
    });
    $$('input[data-num]').forEach(function (el) {
      el.addEventListener('input', function () { sanitizeNumeric(el, true); });
      sanitizeNumeric(el, true);
    });
    $$('input[inputmode="decimal"]').forEach(function (el) {
      if (el.hasAttribute('data-num') || el.hasAttribute('data-int')) return;
      el.addEventListener('input', function () { sanitizeNumeric(el, true); });
      sanitizeNumeric(el, true);
    });
  }

  /* 빠른 선택 버튼 */
  function attachPresets() {
    $$('.preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.target);
        if (!input) return;
        input.value = btn.dataset.value;
        sanitizeNumeric(input, false);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 결과 복사 · 최근 계산 기록(로컬) · 구독                              */
  /* ------------------------------------------------------------------ */
  /* 복사할 결과 문구는 각 계산기가 계산 끝에 setCopyText() 로 넣어 둔다 */
  var COPY_TEXT = {};

  function setCopyText(tool, text) { COPY_TEXT[tool] = text || ''; }

  function flashButton(btn, label) {
    if (!btn) return;
    if (!btn.getAttribute('data-label')) {
      btn.setAttribute('data-label', btn.textContent);
    }
    btn.textContent = label;
    setTimeout(function () {
      btn.textContent = btn.getAttribute('data-label');
    }, 1600);
  }

  function copyText(text, btn) {
    if (!text) return;

    function done() { flashButton(btn, '복사했어요 ✓'); }

    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      try {
        ta.select();
        document.execCommand('copy');
        done();
      } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).then(done, legacy);
        return;
      } catch (e) { /* fallback */ }
    }
    legacy();
  }

  function attachCopy() {
    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyText(COPY_TEXT[btn.dataset.copy], btn);
      });
    });
  }

  /* 저장 내용: 도구 이름 · 결과 요약 · 시각. 입력값은 저장하지 않는다. */
  var HISTORY_KEY = 'daily-tool:history:v1';
  var HISTORY_MAX = 8;
  var historySection = $('#history');
  var historyList = $('#history-list');
  var historyClear = $('#history-clear');
  var historyItems = [];
  var historyTimer = null;
  var historyPending = {};
  var historyCleared = false;

  function readStore() {
    try {
      var raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
    } catch (e) { return []; }
  }

  function writeStore(list) {
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* 저장소 차단 환경 */ }
  }

  function whenLabel(ts) {
    var diff = Date.now() - ts;
    if (!isFinite(diff) || diff < 0) return '';
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function renderHistory() {
    if (!historySection || !historyList) return;

    if (!historyItems.length) {
      historyList.innerHTML = historyCleared
        ? '<li class="history-empty">기록을 모두 지웠어요. 새로 계산하면 다시 쌓입니다.</li>'
        : '';
      historySection.hidden = !historyCleared;
      return;
    }

    historyCleared = false;
    historySection.hidden = false;
    historyList.innerHTML = historyItems.map(function (r) {
      var meta = TOOL_META[r.tool];
      var name = meta ? meta.title : r.tool;
      return '<li>' +
        '<button type="button" class="history-item" data-tool="' + r.tool + '">' +
        '<span class="history-name">' + name + '</span>' +
        '<span class="history-value">' + r.summary + '</span>' +
        '<span class="history-when">' + whenLabel(r.at) + '</span>' +
        '</button>' +
        '</li>';
    }).join('');
  }

  function flushHistory() {
    historyTimer = null;
    var changed = false;

    Object.keys(historyPending).forEach(function (tool) {
      var summary = historyPending[tool];
      historyItems = historyItems.filter(function (r) { return r.tool !== tool; });
      historyItems.unshift({ tool: tool, summary: summary, at: Date.now() });
      changed = true;
    });
    historyPending = {};

    if (!changed) return;
    if (historyItems.length > HISTORY_MAX) historyItems = historyItems.slice(0, HISTORY_MAX);
    historyCleared = false;
    writeStore(historyItems);
    renderHistory();
  }

  /* 입력할 때마다 쌓지 않도록 잠깐 모았다가 한 번에 기록한다 */
  function queueHistory(tool, summary) {
    if (!tool || !summary) return;
    historyPending[tool] = summary;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(flushHistory, 800);
  }

  function attachHistory() {
    if (historyClear) {
      historyClear.addEventListener('click', function () {
        historyItems = [];
        historyPending = {};
        if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; }
        try { window.localStorage.removeItem(HISTORY_KEY); } catch (e) { /* noop */ }
        historyCleared = true;
        renderHistory();
      });
    }

    if (historyList) {
      historyList.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('.history-item') : null;
        if (!item) return;
        setTool(item.dataset.tool, { scroll: true, focus: true });
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 소식 받아보기(옵트인 구독)                                          */
  /* ------------------------------------------------------------------ */
  /* 백엔드가 준비되면 endpoint 에 주소를 넣으면 된다.
     예) Google Apps Script 웹앱 'https://script.google.com/macros/s/…/exec'
         Supabase Edge Function 'https://<project>.supabase.co/functions/v1/subscribe'
     비어 있으면 어떤 요청도 보내지 않고 정직하게 안내만 한다. */
  var NEWSLETTER = {
    endpoint: '',
    formName: 'dailytool-newsletter'
  };

  var CONSENT_TEXT = '개인정보 수집·이용 및 정보 수신에 동의합니다 (이메일, 목적: 뉴스레터 발송, 언제든 철회 가능)';

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v == null ? '' : v).trim());
  }

  function subscribeMessage(text, state) {
    var el = $('#subscribe-status');
    if (!el) return;
    el.textContent = text;
    if (state) el.setAttribute('data-state', state);
    else el.removeAttribute('data-state');
  }

  function attachSubscribe() {
    var form = $('#subscribe-form');
    var btn = $('#subscribe-submit');
    var emailEl = $('#subscribe-email');
    var consentEl = $('#subscribe-consent');
    if (!form || !btn || !emailEl || !consentEl) return;

    function submit() {
      var email = String(emailEl.value == null ? '' : emailEl.value).trim();

      if (!isEmail(email)) {
        subscribeMessage('이메일 주소를 다시 확인해 주세요. 예: name@example.com', 'warn');
        return;
      }
      if (!consentEl.checked) {
        subscribeMessage('아래 동의 항목에 체크해야 신청할 수 있어요. 동의하지 않아도 계산기는 그대로 쓸 수 있습니다.', 'warn');
        return;
      }

      /* 아직 서버가 연결되지 않은 상태: 성공한 척하지 않는다 */
      if (!NEWSLETTER.endpoint) {
        subscribeMessage('현재 베타 준비 중이에요 — 오픈 알림/구독 연결 전까지 신청 내용을 저장하지 않습니다. 그동안 새 소식은 데일리노트 블로그(daily-not.tistory.com)에서 먼저 확인해 보세요!', 'note');
        return;
      }

      if (typeof fetch !== 'function') {
        subscribeMessage('이 브라우저에서는 신청을 보낼 수 없어요. 데일리노트 블로그로 알려 주세요.', 'warn');
        return;
      }

      btn.disabled = true;
      subscribeMessage('신청을 보내는 중이에요…', 'note');

      fetch(NEWSLETTER.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          consent: true,
          consentText: CONSENT_TEXT,
          source: NEWSLETTER.formName,
          at: new Date().toISOString()
        })
      }).then(function (res) {
        if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '?'));
        subscribeMessage('신청이 접수됐어요. 새 소식이 나오면 보내드릴게요. (언제든 철회 가능)', 'note');
        emailEl.value = '';
        consentEl.checked = false;
      }).catch(function () {
        subscribeMessage('신청을 보내지 못했어요. 잠시 뒤 다시 시도하거나 데일리노트 블로그로 알려 주세요.', 'warn');
      }).then(function () {
        btn.disabled = false;
      });
    }

    btn.addEventListener('click', submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 탭 / 라우팅                                                          */
  /* ------------------------------------------------------------------ */
  var TOOL_SECTION = {
    salary: 'calc', severance: 'calc', weekly: 'calc',
    loan: 'calc', percent: 'calc',
    fortune: 'fun', quiz: 'fun'
  };

  /* 도구 목록 카드에 보이는 이름과 안내 문구 — 카드·제목·스크롤 대상이 함께 쓴다 */
  var TOOL_META = {
    salary: { title: '연봉 실수령액', group: '생활·재테크 계산기' },
    severance: { title: '퇴직금', group: '생활·재테크 계산기' },
    weekly: { title: '주휴수당', group: '생활·재테크 계산기' },
    loan: { title: '전세·대출 이자', group: '생활·재테크 계산기' },
    percent: { title: '할인·퍼센트', group: '생활·재테크 계산기' },
    fortune: { title: '오늘의 운세', group: '오늘의 운세·심리테스트' },
    quiz: { title: '심리테스트', group: '오늘의 운세·심리테스트' }
  };

  var panels = { calc: $('#panel-calc'), fun: $('#panel-fun') };
  var tools = {
    salary: $('#tool-salary'), severance: $('#tool-severance'), weekly: $('#tool-weekly'),
    loan: $('#tool-loan'), percent: $('#tool-percent'),
    fortune: $('#tool-fortune'), quiz: $('#tool-quiz')
  };
  var toolCards = $$('.tool-card[data-tool]');
  var workspace = $('#workspace');
  var wsTitle = $('#workspace-title');
  var wsKicker = $('#workspace-kicker');
  var lastBySection = { calc: 'salary', fun: 'fortune' };
  var activeTool = 'salary';

  /* 활성 도구 카드로 이동: 목록 → 도구 영역으로 부드럽게 스크롤하고 초점도 옮긴다 */
  function scrollToWorkspace() {
    if (!workspace || typeof workspace.scrollIntoView !== 'function') return;
    try {
      workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      try { window.scrollTo(0, 0); } catch (e2) { /* noop */ }
    }
  }

  function focusWorkspace() {
    if (!workspace || typeof workspace.focus !== 'function') return;
    try {
      workspace.focus({ preventScroll: true });
    } catch (e) {
      try { workspace.focus(); } catch (e2) { /* noop */ }
    }
  }

  function setTool(name, opts) {
    opts = opts || {};
    if (!TOOL_SECTION[name]) name = 'salary';
    var section = TOOL_SECTION[name];
    lastBySection[section] = name;
    activeTool = name;

    document.body.dataset.section = section;

    Object.keys(panels).forEach(function (k) { panels[k].hidden = (k !== section); });
    Object.keys(tools).forEach(function (k) { if (tools[k]) tools[k].hidden = (k !== name); });

    toolCards.forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.tool === name));
    });

    var meta = TOOL_META[name];
    if (meta) {
      if (wsTitle) wsTitle.textContent = meta.title;
      if (wsKicker) wsKicker.textContent = meta.group;
    }

    if (!opts.silent) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* noop */ }
    }
    if (opts.scroll) scrollToWorkspace();
    if (opts.focus) focusWorkspace();
  }

  toolCards.forEach(function (c) {
    c.addEventListener('click', function () {
      setTool(c.dataset.tool, { scroll: true, focus: true });
    });
  });

  /* 푸터·본문 안의 #링크도 탭 전환으로 처리 (입력 요소 id 와의 충돌 방지) */
  $$('a[href^="#"]').forEach(function (a) {
    var name = (a.getAttribute('href') || '').replace('#', '');
    if (!TOOL_SECTION[name]) return;
    a.addEventListener('click', function (e) {
      e.preventDefault();
      setTool(name, { scroll: true });
    });
  });

  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace('#', '');
    if (TOOL_SECTION[h] && h !== activeTool) setTool(h, { silent: true });
  });

  /* ------------------------------------------------------------------ */
  /* 1) 연봉 실수령액                                                    */
  /* ------------------------------------------------------------------ */
  /* 2026년 근로자 부담 요율
     국민연금 4.75% (기준소득월액 상한 659만·하한 41만)
     건강보험 3.595% (본인 몫 상한 4,591,740원·하한 10,080원)
     장기요양 = 건강보험료 × 13.14%
     고용보험(실업급여) 0.9% */
  var INS = {
    npRate: 0.0475, npMin: 410000, npMax: 6590000,
    hiRate: 0.03595, hiMin: 10080, hiMax: 4591740,
    ltRatio: 0.1314,
    eiRate: 0.009
  };

  function calcInsurance(monthlyTaxable) {
    var npBase = clamp(Math.floor(monthlyTaxable / 1000) * 1000, INS.npMin, INS.npMax);
    var np = floor10(npBase * INS.npRate);

    var hi = clamp(Math.floor(monthlyTaxable * INS.hiRate + 1e-9), INS.hiMin, INS.hiMax);
    hi = floor10(hi);

    var lt = floor10(hi * INS.ltRatio);
    var ei = floor10(monthlyTaxable * INS.eiRate);

    return { np: np, hi: hi, lt: lt, ei: ei, total: np + hi + lt + ei };
  }

  function earnedIncomeDeduction(gross) {
    if (gross <= 5000000) return gross * 0.7;
    if (gross <= 15000000) return 3500000 + (gross - 5000000) * 0.4;
    if (gross <= 45000000) return 7500000 + (gross - 15000000) * 0.15;
    if (gross <= 100000000) return 12000000 + (gross - 45000000) * 0.05;
    return 14750000 + (gross - 100000000) * 0.02;
  }

  /* 소득세 기본세율 (2023년 개정 구간) */
  var BRACKETS = [
    [14000000, 0.06, 0],
    [50000000, 0.15, 1260000],
    [88000000, 0.24, 5760000],
    [150000000, 0.35, 15440000],
    [300000000, 0.38, 19940000],
    [500000000, 0.40, 25940000],
    [1000000000, 0.42, 35940000],
    [Infinity, 0.45, 65940000]
  ];

  function taxFromBase(base) {
    for (var i = 0; i < BRACKETS.length; i++) {
      if (base <= BRACKETS[i][0]) {
        return Math.max(0, base * BRACKETS[i][1] - BRACKETS[i][2]);
      }
    }
    return 0;
  }

  function calcIncomeTax(grossTaxable, deps, ins) {
    var earned = Math.max(0, grossTaxable - earnedIncomeDeduction(grossTaxable));

    var personal = 1500000 * deps;                       /* 기본공제 */
    var pensionDed = ins.np * 12;                        /* 연금보험료공제 */
    var healthDed = (ins.hi + ins.lt) * 12;              /* 건강보험료공제 */
    var standard = 130000;                               /* 표준세액공제 */

    var base = Math.max(0, Math.floor(earned - personal - pensionDed - healthDed - standard + 1e-9));
    var grossTax = Math.floor(taxFromBase(base) + 1e-9);

    /* 근로소득세액공제 */
    var credit = grossTax <= 1300000
      ? grossTax * 0.55
      : 715000 + (grossTax - 1300000) * 0.30;
    var cap = grossTaxable <= 33000000 ? 740000
      : grossTaxable <= 70000000 ? 660000
        : 500000;
    credit = Math.min(credit, cap);

    var incomeTax = Math.max(0, Math.floor(grossTax - credit + 1e-9));
    var localTax = Math.floor(incomeTax * 0.1 + 1e-9);

    return {
      base: base, grossTax: grossTax, credit: credit,
      incomeTax: incomeTax, localTax: localTax,
      total: incomeTax + localTax
    };
  }

  var salaryEls = {
    annual: $('#salary'),
    nonTax: $('#salary-nontax'),
    deps: $('#salary-deps')
  };

  function updateSalary(user) {
    var annual = parseNum(salaryEls.annual.value) * 10000;
    var nonTaxMonth = clamp(parseNum(salaryEls.nonTax.value), 0, 10000000);
    var deps = clamp(parseNum(salaryEls.deps.value) || 1, 1, 6);

    var out = {
      month: $('#res-salary-month'), year: $('#res-salary-year'),
      deduct: $('#res-salary-deduct'), ins: $('#res-salary-ins'),
      tax: $('#res-salary-tax'), rate: $('#res-salary-rate'),
      bdNp: $('#bd-np'), bdHi: $('#bd-hi'), bdLt: $('#bd-lt'), bdEi: $('#bd-ei'),
      bdIns: $('#bd-ins'), bdIt: $('#bd-it'), bdLt2: $('#bd-lt2'), bdTax: $('#bd-tax')
    };

    if (!annual || annual <= 0) {
      ['month', 'year', 'deduct', 'ins', 'tax', 'rate'].forEach(function (k) {
        out[k].textContent = '—';
      });
      ['bdNp', 'bdHi', 'bdLt', 'bdEi', 'bdIns', 'bdIt', 'bdLt2', 'bdTax'].forEach(function (k) {
        out[k].textContent = '—';
      });
      setCopyText('salary', '');
      return;
    }

    var taxableAnnual = Math.max(0, annual - nonTaxMonth * 12);
    var monthlyTaxable = taxableAnnual / 12;

    var ins = calcInsurance(monthlyTaxable);
    var tax = calcIncomeTax(taxableAnnual, deps, ins);

    var annualIns = ins.total * 12;
    var annualNet = Math.max(0, annual - annualIns - tax.total);
    var monthlyNet = annualNet / 12;
    var monthlyDeduct = (annualIns + tax.total) / 12;

    out.month.textContent = won(monthlyNet);
    out.year.textContent = won(annualNet);
    out.deduct.textContent = won(monthlyDeduct);
    out.ins.textContent = won(ins.total);
    out.tax.textContent = won(tax.total / 12);
    out.rate.textContent = annual > 0 ? fmt2((annualNet / annual) * 100) + '%' : '—';

    out.bdNp.textContent = won(ins.np);
    out.bdHi.textContent = won(ins.hi);
    out.bdLt.textContent = won(ins.lt);
    out.bdEi.textContent = won(ins.ei);
    out.bdIns.textContent = won(ins.total);
    out.bdIt.textContent = won(tax.incomeTax / 12);
    out.bdLt2.textContent = won(tax.localTax / 12);
    out.bdTax.textContent = won(tax.total / 12);

    setCopyText('salary', [
      '💰 연봉 실수령액 (예상) — 데일리툴',
      '연봉 ' + fmt(annual / 10000) + '만원 · 부양가족 ' + deps + '명',
      '월 실수령 ' + won(monthlyNet) + ' / 연 ' + won(annualNet),
      '월 공제 ' + won(monthlyDeduct) + ' (4대보험 ' + won(ins.total) + ' · 세금 ' + won(tax.total / 12) + ')',
      '실수령률 ' + fmt2((annualNet / annual) * 100) + '%',
      'https://' + location.host + '/#salary'
    ].join('\n'));

    if (user) queueHistory('salary', '월 ' + won(monthlyNet));
  }

  /* ------------------------------------------------------------------ */
  /* 2) 전세 · 대출 이자                                                  */
  /* ------------------------------------------------------------------ */
  var loanEls = {
    amount: $('#loan-amount'),
    term: $('#loan-term'),
    unit: $('#loan-term-unit'),
    rate: $('#loan-rate'),
    method: $('#loan-method')
  };

  function loanSchedule(principal, r, n, method) {
    var rows = [];
    var balance = principal;
    var totalInterest = 0;
    var monthly = 0;

    if (method === 'equal-payment') {
      monthly = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
    } else if (method === 'equal-principal') {
      monthly = principal / n;
    }

    var firstPay = 0, lastPay = 0, firstInt = 0, lastInt = 0;

    for (var i = 1; i <= n; i++) {
      var interest = balance * r;
      var principalPart;
      var pay;

      if (method === 'bullet') {
        principalPart = (i === n) ? balance : 0;
        pay = interest + principalPart;
      } else if (method === 'equal-principal') {
        principalPart = (i === n) ? balance : principal / n;
        pay = interest + principalPart;
      } else {
        principalPart = monthly - interest;
        if (i === n) principalPart = balance;
        pay = interest + principalPart;
      }

      if (i === 1) { firstPay = pay; firstInt = interest; }
      if (i === n) { lastPay = pay; lastInt = interest; }

      balance = Math.max(0, balance - principalPart);
      totalInterest += interest;
    }

    return {
      totalInterest: totalInterest,
      total: principal + totalInterest,
      monthly: monthly,
      firstPay: firstPay,
      lastPay: lastPay,
      firstInt: firstInt,
      lastInt: lastInt
    };
  }

  function updateLoan(user) {
    var principal = parseNum(loanEls.amount.value) * 10000;
    var rawTerm = parseNum(loanEls.term.value);
    var months = Math.max(0, Math.round(loanEls.unit.value === 'year' ? rawTerm * 12 : rawTerm));
    var ratePct = clamp(parseNum(loanEls.rate.value), 0, 100);
    var r = ratePct / 100 / 12;
    var method = loanEls.method.value;

    var label = $('#res-loan-label');
    var hero = $('#res-loan-monthly');
    var note = $('#res-loan-note');
    var interestEl = $('#res-loan-interest');
    var totalEl = $('#res-loan-total');
    var countEl = $('#res-loan-count');
    var ratioEl = $('#res-loan-ratio');
    var schedEl = $('#loan-schedule');

    if (principal <= 0 || months <= 0) {
      label.textContent = '월 납입액 (예상)';
      hero.textContent = '—';
      note.textContent = '대출 금액과 기간을 입력해 주세요.';
      interestEl.textContent = '—';
      totalEl.textContent = '—';
      countEl.textContent = '—';
      ratioEl.textContent = '—';
      schedEl.innerHTML = '<li><span>—</span><span>—</span></li>';
      setCopyText('loan', '');
      return;
    }

    var s = loanSchedule(principal, r, months, method);
    var rows = [];

    if (method === 'bullet') {
      label.textContent = '월 이자 (예상)';
      hero.textContent = won(principal * r);
      note.textContent = months + '개월 동안 이자만 · 만기에 원금 ' + shortKrw(principal) + ' 상환';
      rows = [
        ['월 이자', won(principal * r)],
        ['만기 상환 원금', won(principal)],
        ['총 이자', won(s.totalInterest)],
        ['총 상환액', won(s.total)]
      ];
    } else if (method === 'equal-principal') {
      label.textContent = '첫 달 납입액 (예상)';
      hero.textContent = won(s.firstPay);
      note.textContent = '마지막 달 ' + won(s.lastPay) + ' · 매달 원금 ' + won(principal / months) + '씩 감소';
      rows = [
        ['매달 상환 원금', won(principal / months)],
        ['첫 달 이자', won(s.firstInt)],
        ['마지막 달 이자', won(s.lastInt)],
        ['총 이자', won(s.totalInterest)],
        ['총 상환액', won(s.total)]
      ];
    } else {
      label.textContent = '월 납입액 (예상)';
      hero.textContent = won(s.monthly);
      note.textContent = '매달 같은 금액 · ' + months + '회 납입';
      rows = [
        ['첫 달 이자', won(s.firstInt)],
        ['첫 달 원금', won(s.monthly - s.firstInt)],
        ['마지막 달 이자', won(s.lastInt)],
        ['총 이자', won(s.totalInterest)],
        ['총 상환액', won(s.total)]
      ];
    }

    interestEl.textContent = won(s.totalInterest);
    totalEl.textContent = won(s.total);
    countEl.textContent = months + '회';
    ratioEl.textContent = s.total > 0 ? fmt2((s.totalInterest / s.total) * 100) + '%' : '0%';

    schedEl.innerHTML = rows.map(function (row) {
      return '<li><span>' + row[0] + '</span><span>' + row[1] + '</span></li>';
    }).join('');

    var methodName = method === 'bullet' ? '만기일시상환'
      : method === 'equal-principal' ? '원금균등상환' : '원리금균등상환';

    setCopyText('loan', [
      '🏦 전세·대출 이자 (예상) — 데일리툴',
      shortKrw(principal) + ' · ' + months + '개월 · 연 ' + fmt2(ratePct) + '% · ' + methodName,
      label.textContent + ' ' + hero.textContent,
      '총 이자 ' + won(s.totalInterest) + ' / 총 상환액 ' + won(s.total),
      note.textContent,
      'https://' + location.host + '/#loan'
    ].join('\n'));

    if (user) queueHistory('loan', '월 ' + hero.textContent + ' · 총 이자 ' + won(s.totalInterest));
  }

  /* ------------------------------------------------------------------ */
  /* 3) 퇴직금                                                            */
  /* ------------------------------------------------------------------ */
  var sevEls = {
    start: $('#sev-start'),
    end: $('#sev-end'),
    monthly: $('#sev-monthly'),
    bonus: $('#sev-bonus'),
    leave: $('#sev-leave')
  };

  function toDate(iso) {
    if (!iso) return null;
    var d = new Date(String(iso) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  function dayDiff(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }

  /* 월 단위 날짜 이동 (1월 31일 − 1개월 = 12월 31일처럼 말일 보정) */
  function addMonths(date, delta) {
    var y = date.getFullYear();
    var m = date.getMonth() + delta;
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(date.getDate(), last));
  }

  /* 퇴직금 = 1일 평균임금 × 30 × 재직일수 ÷ 365
     1일 평균임금 = (최근 3개월 임금 총액) ÷ (그 기간의 총 일수) */
  function severanceEstimate(o) {
    var start = o.start;
    var end = o.end;
    if (!start || !end || end.getTime() < start.getTime()) {
      return { ok: false, reason: 'date' };
    }

    var workDays = dayDiff(start, end) + 1;
    var periodStart = addMonths(end, -3);
    var periodEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    var periodDays = dayDiff(periodStart, periodEnd) + 1;

    var salary3 = Math.max(0, o.monthly) * 3;
    var bonus = Math.max(0, o.bonus || 0);
    var leave = Math.max(0, o.leave || 0);
    var total = salary3 + bonus + leave;
    var avgDaily = periodDays > 0 ? total / periodDays : 0;
    var pay = avgDaily * 30 * workDays / 365;

    return {
      ok: true,
      workDays: workDays,
      periodDays: periodDays,
      salary3: salary3,
      bonus: bonus,
      leave: leave,
      total: total,
      avgDaily: avgDaily,
      pay: pay,
      eligible: workDays >= 365
    };
  }

  function updateSeverance(user) {
    var start = toDate(sevEls.start.value);
    var end = toDate(sevEls.end.value) || toDate(todayKey());
    var monthly = parseNum(sevEls.monthly.value) * 10000;
    var bonus = parseNum(sevEls.bonus.value);
    var leave = parseNum(sevEls.leave.value);

    var hero = $('#res-sev-pay');
    var note = $('#res-sev-note');
    var elAvg = $('#res-sev-avg');
    var elDays = $('#res-sev-days');
    var elTotal = $('#res-sev-total');
    var elMDays = $('#res-sev-mdays');

    function clearAll(msg) {
      hero.textContent = '—';
      note.textContent = msg;
      [elAvg, elDays, elTotal, elMDays].forEach(function (el) { el.textContent = '—'; });
      setCopyText('severance', '');
    }

    if (!start) { clearAll('입사일을 입력해 주세요.'); return; }
    if (!monthly) { clearAll('최근 3개월 월 급여를 입력해 주세요.'); return; }

    var r = severanceEstimate({ start: start, end: end, monthly: monthly, bonus: bonus, leave: leave });
    if (!r.ok) { clearAll('퇴사일이 입사일보다 빠릅니다. 날짜를 확인해 주세요.'); return; }

    hero.textContent = won(r.pay);
    note.textContent = r.eligible
      ? '재직 ' + fmt(r.workDays) + '일 · 1일 평균임금 ' + won(r.avgDaily)
      : '재직 1년 미만 — 법정 퇴직금 지급 대상이 아닙니다. 참고값이에요.';

    elAvg.textContent = won(r.avgDaily);
    elDays.textContent = fmt(r.workDays) + '일';
    elTotal.textContent = won(r.total);
    elMDays.textContent = fmt(r.periodDays) + '일';

    var bd = {
      salary: $('#bd-sev-salary'), bonus: $('#bd-sev-bonus'), leave: $('#bd-sev-leave'),
      total: $('#bd-sev-total'), mdays: $('#bd-sev-mdays'), avg: $('#bd-sev-avg'),
      years: $('#bd-sev-years'), pay: $('#bd-sev-pay')
    };
    if (bd.salary) bd.salary.textContent = won(r.salary3);
    if (bd.bonus) bd.bonus.textContent = won(r.bonus);
    if (bd.leave) bd.leave.textContent = won(r.leave);
    if (bd.total) bd.total.textContent = won(r.total);
    if (bd.mdays) bd.mdays.textContent = fmt(r.periodDays) + '일';
    if (bd.avg) bd.avg.textContent = won(r.avgDaily);
    if (bd.years) bd.years.textContent = fmt2(r.workDays / 365) + '년분';
    if (bd.pay) bd.pay.textContent = won(r.pay);

    setCopyText('severance', [
      '💼 예상 퇴직금 (세전) — 데일리툴',
      '재직 ' + fmt(r.workDays) + '일 (' + fmt2(r.workDays / 365) + '년분) · 1일 평균임금 ' + won(r.avgDaily),
      '예상 퇴직금 ' + won(r.pay),
      '최근 3개월 임금 총액 ' + won(r.total) + ' ÷ ' + fmt(r.periodDays) + '일',
      r.eligible ? '근로기준법 기준 예상치입니다.' : '재직 1년 미만이라 법정 퇴직금 대상이 아닙니다.',
      'https://' + location.host + '/#severance'
    ].join('\n'));

    if (user) queueHistory('severance', won(r.pay) + ' (' + fmt2(r.workDays / 365) + '년)');
  }

  /* ------------------------------------------------------------------ */
  /* 4) 주휴수당                                                          */
  /* ------------------------------------------------------------------ */
  var WEEK_WEEKS_PER_MONTH = 4.345;   /* 365일 ÷ 12개월 ÷ 7일 */

  var wkEls = {
    hourly: $('#wk-hourly'),
    hours: $('#wk-hours')
  };

  /* 주휴수당 = 시급 × 주휴 인정시간
     40시간 이상 8시간 / 40시간 미만 주 소정근로시간 ÷ 5 (15시간 미만은 0) */
  function weeklyEstimate(hourly, hours) {
    var h = clamp(hours, 0, 168);
    var eligible = h >= 15;
    var holidayHours = h >= 40 ? 8 : h / 5;
    var holidayPay = eligible ? hourly * holidayHours : 0;
    var workPay = hourly * h;
    var weekTotal = workPay + holidayPay;

    return {
      eligible: eligible,
      hours: h,
      holidayHours: holidayHours,
      holidayPay: holidayPay,
      workPay: workPay,
      weekTotal: weekTotal,
      monthWork: workPay * WEEK_WEEKS_PER_MONTH,
      monthTotal: weekTotal * WEEK_WEEKS_PER_MONTH,
      monthHoliday: holidayPay * WEEK_WEEKS_PER_MONTH
    };
  }

  function updateWeekly(user) {
    var hourly = parseNum(wkEls.hourly.value);
    var hours = parseNum(wkEls.hours.value);

    var hero = $('#res-wk-pay');
    var note = $('#res-wk-note');
    var elWork = $('#res-wk-work');
    var elWeek = $('#res-wk-week');
    var elMonth = $('#res-wk-month');
    var elMonthBase = $('#res-wk-monthbase');

    function clearAll(msg) {
      hero.textContent = '—';
      note.textContent = msg;
      [elWork, elWeek, elMonth, elMonthBase].forEach(function (el) { el.textContent = '—'; });
      setCopyText('weekly', '');
    }

    if (!hourly) { clearAll('시급을 입력해 주세요.'); return; }
    if (!hours) { clearAll('1주 소정근로시간을 입력해 주세요.'); return; }

    var r = weeklyEstimate(hourly, hours);

    hero.textContent = won(r.holidayPay);
    note.textContent = r.eligible
      ? '주 ' + fmt2(r.hours) + '시간 · 주휴 ' + fmt2(r.holidayHours) + '시간분'
      : '주 소정근로시간 15시간 미만 — 주휴수당 지급 대상이 아닙니다.';

    elWork.textContent = won(r.workPay);
    elWeek.textContent = won(r.weekTotal);
    elMonth.textContent = won(r.monthTotal);
    elMonthBase.textContent = won(r.monthWork);

    var bd = {
      holhours: $('#bd-wk-holhours'), hourly: $('#bd-wk-hourly'), hours: $('#bd-wk-hours'),
      pay: $('#bd-wk-pay'), weeks: $('#bd-wk-weeks'), monthpay: $('#bd-wk-monthpay')
    };
    if (bd.holhours) bd.holhours.textContent = fmt2(r.holidayHours) + '시간';
    if (bd.hourly) bd.hourly.textContent = won(hourly);
    if (bd.hours) bd.hours.textContent = fmt2(r.hours) + '시간';
    if (bd.pay) bd.pay.textContent = won(r.holidayPay);
    if (bd.weeks) bd.weeks.textContent = fmt2(WEEK_WEEKS_PER_MONTH) + '주';
    if (bd.monthpay) bd.monthpay.textContent = won(r.monthHoliday);

    setCopyText('weekly', [
      '⏰ 주휴수당 (예상) — 데일리툴',
      '시급 ' + won(hourly) + ' · 주 ' + fmt2(r.hours) + '시간',
      '주휴수당 ' + won(r.holidayPay) + ' (주휴 ' + fmt2(r.holidayHours) + '시간분)',
      '주급 ' + won(r.weekTotal) + ' / 월 예상 ' + won(r.monthTotal) + ' (4.345주 기준)',
      r.eligible ? '주 15시간 이상 개근 시 지급 대상입니다.' : '주 15시간 미만은 주휴수당이 발생하지 않습니다.',
      'https://' + location.host + '/#weekly'
    ].join('\n'));

    if (user) queueHistory('weekly', r.eligible ? '주 ' + won(r.holidayPay) : '대상 아님(주 ' + fmt2(r.hours) + '시간)');
  }

  /* ------------------------------------------------------------------ */
  /* 5) 퍼센트 · 할인율                                                   */
  /* ------------------------------------------------------------------ */
  var percentMode = 'p1';

  function setPercentMode(mode) {
    percentMode = mode;
    $$('.chip[data-pmode]').forEach(function (c) {
      var on = c.dataset.pmode === mode;
      c.setAttribute('aria-selected', String(on));
      c.tabIndex = on ? 0 : -1;
    });
    $$('.pmode').forEach(function (p) { p.hidden = p.id !== 'pmode-' + mode; });
    updatePercent();
  }

  function setMiniLabel(inputId, text) {
    var out = $(inputId);
    if (!out) return;
    var box = out.closest('.mini-result');
    if (!box) return;
    var lab = box.querySelector('.mini-label');
    if (lab) lab.textContent = text;
  }

  function updatePercent(user) {
    /* p1: 값의 % */
    var x = parseNum($('#p1-x').value);
    var y = parseNum($('#p1-y').value);
    $('#p1-out').textContent = won(x * y / 100);
    setMiniLabel('#p1-out', fmt(x) + '의 ' + fmt2(y) + '%');

    /* p2: 비율 */
    var a = parseNum($('#p2-a').value);
    var b = parseNum($('#p2-b').value);
    $('#p2-out').textContent = b === 0 ? '—' : fmt2(a / b * 100) + '%';
    $('#p2-out').setAttribute('title', b === 0 ? '전체 값이 0이면 계산할 수 없습니다.' : '');

    /* p3: 증감률 */
    var from = parseNum($('#p3-from').value);
    var to = parseNum($('#p3-to').value);
    var diff = to - from;
    var pct = from === 0 ? null : (diff / from) * 100;
    if (pct === null) {
      $('#p3-out').textContent = '—';
      $('#p3-diff').textContent = '이전 값이 0이면 증감률을 계산할 수 없습니다.';
    } else {
      $('#p3-out').textContent = (pct > 0 ? '+' : '') + fmt2(pct) + '%';
      $('#p3-out').style.color = pct > 0 ? 'var(--up)' : pct < 0 ? 'var(--down)' : 'var(--brand-ink)';
      $('#p3-diff').textContent = '차이 ' + (diff > 0 ? '+' : '') + won(diff).replace('원', '') + '원';
    }

    /* p4: 할인가 */
    var price = parseNum($('#p4-price').value);
    var rate = clamp(parseNum($('#p4-rate').value), 0, 100);
    var cut = price * rate / 100;
    $('#p4-out').textContent = won(price - cut);
    $('#p4-cut').textContent = '할인액 ' + won(cut);

    /* p5: 할인율 */
    var price2 = parseNum($('#p5-price').value);
    var sale = parseNum($('#p5-sale').value);
    if (price2 === 0) {
      $('#p5-out').textContent = '—';
      $('#p5-cut').textContent = '정가를 입력해 주세요.';
    } else {
      var r2 = (1 - sale / price2) * 100;
      $('#p5-out').textContent = (r2 > 0 ? '' : '') + fmt2(r2) + '%';
      $('#p5-out').style.color = r2 < 0 ? 'var(--down)' : 'var(--brand-ink)';
      $('#p5-cut').textContent = r2 < 0
        ? '할인액 ' + won(price2 - sale) + ' (정가보다 비쌉니다)'
        : '할인액 ' + won(price2 - sale);
    }

    /* 지금 보고 있는 계산 한 줄만 복사/기록한다 */
    var line = '';
    if (percentMode === 'p1') {
      line = fmt(x) + '의 ' + fmt2(y) + '% = ' + won(x * y / 100);
    } else if (percentMode === 'p2') {
      line = b === 0 ? '' : fmt(a) + ' ÷ ' + fmt(b) + ' = ' + fmt2(a / b * 100) + '%';
    } else if (percentMode === 'p3') {
      line = pct === null ? '' : fmt(from) + ' → ' + fmt(to) + ' = ' + (pct > 0 ? '+' : '') + fmt2(pct) + '%';
    } else if (percentMode === 'p4') {
      line = fmt(price) + '의 ' + fmt2(rate) + '% 할인 = ' + won(price - cut) + ' (할인액 ' + won(cut) + ')';
    } else {
      line = price2 === 0 ? '' : fmt(price2) + ' → ' + fmt(sale) + ' = ' + fmt2((1 - sale / price2) * 100) + '% 할인';
    }

    setCopyText('percent', line
      ? ['🧮 퍼센트·할인 계산 — 데일리툴', line, 'https://' + location.host + '/#percent'].join('\n')
      : '');

    if (user && line) queueHistory('percent', line);
  }

  /* ------------------------------------------------------------------ */
  /* 6) 오늘의 운세                                                       */
  /* ------------------------------------------------------------------ */
  var ZODIAC = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
  var ZODIAC_EMOJI = {
    '쥐': '🐭', '소': '🐮', '호랑이': '🐯', '토끼': '🐰', '용': '🐲', '뱀': '🐍',
    '말': '🐴', '양': '🐑', '원숭이': '🐵', '닭': '🐔', '개': '🐶', '돼지': '🐷'
  };

  var ZODIAC_TRAIT = {
    '쥐': '눈치가 빠르고 시작이 재빠른',
    '소': '한 번 정하면 끝까지 가는',
    '호랑이': '앞에 나서는 기세가 좋은',
    '토끼': '분위기를 부드럽게 만드는',
    '용': '큰 그림을 그리는',
    '뱀': '속을 잘 읽고 신중한',
    '말': '멈추지 않고 달리는',
    '양': '사람을 편하게 하는',
    '원숭이': '무엇이든 금방 익히는',
    '닭': '부지런하고 야무진',
    '개': '의리를 지키는',
    '돼지': '복을 불러오는'
  };

  var STAR_SIGNS = [
    [1, 20, '물병'], [2, 19, '물고기'], [3, 21, '양'], [4, 20, '황소'],
    [5, 21, '쌍둥이'], [6, 21, '게'], [7, 23, '사자'], [8, 23, '처녀'],
    [9, 23, '천칭'], [10, 23, '전갈'], [11, 22, '사수'], [12, 22, '염소']
  ];

  function starSign(month, day) {
    var idx = month - 1;
    var row = STAR_SIGNS[idx];
    if (day < row[1]) return idx === 0 ? '염소' : STAR_SIGNS[idx - 1][2];
    return row[2];
  }

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rngFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function todayLabel() {
    var d = new Date();
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' +
      days[d.getDay()] + '요일';
  }

  var COMMON = {
    taglines: [
      '흐름이 부드러운 하루, 작은 결정이 크게 작용해요.',
      '속도보다 방향이 중요한 날, 한 번 더 확인해 보세요.',
      '기분 좋은 소식이 먼저 도착하는 하루예요.',
      '애매한 건 오늘 정하지 않아도 괜찮은 날.',
      '누군가에게 손을 내밀면 두 배로 돌아오는 날이에요.',
      '정리와 마무리에 특히 잘 어울리는 하루입니다.',
      '예상 밖의 즐거움이 하나쯤 숨어 있는 날.',
      '무리하지 않으면 오래 좋은 흐름이 이어져요.',
      '말보다 행동이 빨리 결과로 이어지는 하루예요.',
      '한 끼 잘 챙기면 하루 전체가 달라지는 날.'
    ],
    advice: [
      '아침에 미뤄둔 일 하나만 끝내면 오후가 훨씬 가벼워집니다.',
      '돈이 오가는 약속은 말로만 정하지 말고 한 줄이라도 적어두세요.',
      '오늘은 “내일 하지”보다 “지금 5분만”이 효과적입니다.',
      '고맙다는 말 한마디가 관계의 온도를 올리는 날이에요.',
      '큰 지출은 하루만 미뤄보세요. 대부분 그 사이 답이 나옵니다.',
      '누군가의 부탁을 거절해야 한다면, 대안을 함께 건네보세요.',
      '핸드폰을 잠깐 내려놓으면 놓치고 있던 게 보입니다.',
      '오늘의 컨디션은 어제의 수면이 결정합니다. 오늘은 일찍 눕기.',
      '메모 하나가 내일의 나를 구합니다. 떠오른 건 바로 적으세요.',
      '잘 안 풀리는 일은 사람에게 물어보세요. 오늘은 답이 잘 옵니다.'
    ],
    caution: [
      '말이 앞서면 오해가 생깁니다. 한 박자 쉬고 말하세요.',
      '충동 결제에 약한 날입니다. 장바구니에서 하루만 묵혀두세요.',
      '무리한 일정은 몸이 먼저 신호를 보냅니다. 중간 휴식을 챙기세요.',
      '서두르면 디테일을 놓칩니다. 마지막 확인 한 번.',
      '감정이 올라오면 자리를 잠깐 비우는 게 낫습니다.',
      '약속 시간에는 여유 있게 움직이세요. 5분이 하루를 바꿉니다.',
      '남의 일에 지나치게 개입하면 피곤해집니다. 선을 지켜주세요.',
      '확인하지 않은 정보는 옮기지 마세요. 오늘은 특히.'
    ],
    colors: ['하늘색', '연두색', '주황색', '아이보리', '남색', '분홍색', '은색', '카키', '보라색', '흰색'],
    items: ['텀블러', '손수건', '이어폰', '작은 수첩', '볼펜', '립밤', '우산', '머그컵'],
    times: ['오전 7시~9시', '오전 9시~11시', '오전 11시~오후 1시', '오후 1시~3시', '오후 3시~5시', '오후 5시~7시', '저녁 7시~9시', '밤 9시 이후'],
    goodActions: ['먼저 인사하기', '미뤄둔 연락하기', '책상 정리', '산책 10분', '물 2잔 더 마시기', '고마운 사람에게 메시지', '창문 열고 환기하기', '평소보다 10분 일찍 움직이기']
  };

  function fortuneFor(zodiac, key) {
    var rnd = rngFrom(hash32(key + '|' + zodiac));
    var names = ['총운', '금전운', '애정운', '건강운', '일·학업운'];
    var scores = names.map(function () { return 55 + Math.floor(rnd() * 42); });

    return {
      zodiac: zodiac,
      names: names,
      scores: scores,
      total: scores[0],
      tagline: pick(COMMON.taglines, rnd),
      advice: pick(COMMON.advice, rnd),
      caution: pick(COMMON.caution, rnd),
      color: pick(COMMON.colors, rnd),
      item: pick(COMMON.items, rnd),
      time: pick(COMMON.times, rnd),
      number: 1 + Math.floor(rnd() * 45),
      action: pick(COMMON.goodActions, rnd)
    };
  }

  var fortuneEls = {
    birth: $('#fortune-birth'),
    zodiac: $('#fortune-zodiac'),
    result: $('#fortune-result'),
    empty: $('#fortune-empty'),
    who: $('#fortune-who'),
    score: $('#fortune-score'),
    tagline: $('#fortune-tagline'),
    bars: $('#fortune-bars'),
    advice: $('#fortune-advice'),
    luck: $('#fortune-luck'),
    caution: $('#fortune-caution'),
    rank: $('#fortune-rank'),
    copy: $('#fortune-copy'),
    today: $('#fortune-today')
  };

  var currentFortune = null;

  function renderFortune() {
    var key = todayKey();
    var birth = fortuneEls.birth.value;
    var chosen = fortuneEls.zodiac.value;

    var zodiac = '';
    var year = 0;
    var month = 0;
    var day = 0;
    var fromBirth = false;

    if (birth) {
      var d = new Date(birth + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        year = d.getFullYear();
        month = d.getMonth() + 1;
        day = d.getDate();
        zodiac = ZODIAC[(((year - 4) % 12) + 12) % 12];
        fromBirth = true;
      }
    }
    if (chosen) zodiac = chosen;           /* 띠를 직접 고르면 그쪽을 우선 */
    if (!zodiac) {
      fortuneEls.result.hidden = true;
      fortuneEls.empty.hidden = false;
      currentFortune = null;
      return;
    }

    var f = fortuneFor(zodiac, key);

    fortuneEls.result.hidden = false;
    fortuneEls.empty.hidden = true;

    var whoParts = [ZODIAC_EMOJI[zodiac] + ' ' + zodiac + '띠'];
    if (fromBirth && year) whoParts.push(year + '년생');
    if (fromBirth && month) whoParts.push(starSign(month, day) + '자리');
    whoParts.push(todayLabel());

    fortuneEls.who.textContent = whoParts.join(' · ');
    fortuneEls.score.textContent = f.total + '점';
    fortuneEls.tagline.textContent = f.tagline;

    fortuneEls.bars.innerHTML = f.names.map(function (name, i) {
      return '<li>' +
        '<div class="bar-top"><span class="bar-name">' + name + '</span>' +
        '<span class="bar-score">' + f.scores[i] + '</span></div>' +
        '<div class="bar-track"><span class="bar-fill" style="width:' + f.scores[i] + '%"></span></div>' +
        '</li>';
    }).join('');

    fortuneEls.advice.textContent = f.advice;
    fortuneEls.caution.textContent = f.caution;

    var luck = [
      ['행운의 색', f.color],
      ['행운의 숫자', f.number],
      ['행운의 시간', f.time],
      ['행운의 아이템', f.item],
      ['오늘 해볼 일', f.action]
    ];
    fortuneEls.luck.innerHTML = luck.map(function (row) {
      return '<li><span class="luck-k">' + row[0] + '</span><span class="luck-v">' + row[1] + '</span></li>';
    }).join('');

    /* 띠별 순위 */
    var all = ZODIAC.map(function (z) {
      return { z: z, s: fortuneFor(z, key).total };
    }).sort(function (a, b) { return b.s - a.s; });

    fortuneEls.rank.innerHTML = all.map(function (row, i) {
      var me = row.z === zodiac ? ' class="me"' : '';
      return '<li' + me + '><span class="rank-no">' + (i + 1) + '</span>' +
        '<span class="rank-name">' + ZODIAC_EMOJI[row.z] + ' ' + row.z + '띠</span>' +
        '<span class="rank-score">' + row.s + '점</span></li>';
    }).join('');

    currentFortune = { f: f, who: whoParts.join(' · ') };
  }

  function copyFortune() {
    if (!currentFortune) return;
    var f = currentFortune.f;
    var lines = [
      '🔮 오늘의 운세 — ' + currentFortune.who,
      '',
      f.names.map(function (n, i) { return n + ' ' + f.scores[i] + '점'; }).join(' / '),
      '',
      f.tagline,
      '',
      '💡 ' + f.advice,
      '⚠️ ' + f.caution,
      '',
      '행운의 색 ' + f.color + ' · 숫자 ' + f.number + ' · 시간 ' + f.time,
      '',
      '데일리툴 · https://' + location.host + '/#fortune'
    ];
    var text = lines.join('\n');

    var done = function () {
      var btn = fortuneEls.copy;
      var prev = btn.textContent;
      btn.textContent = '복사했어요 ✓';
      setTimeout(function () { btn.textContent = prev; }, 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 7) 심리테스트                                                        */
  /* ------------------------------------------------------------------ */
  var QUIZZES = {
    spend: {
      title: '나의 소비 성향 테스트',
      lead: '평소 쇼핑과 지출 습관을 떠올리며 답해 주세요. 정답은 없습니다.',
      minutes: '약 2분',
      questions: [
        {
          q: '쇼핑몰 장바구니에 5만원짜리 옷이 담겨 있다.',
          opts: [
            { t: '세일할 때까지 기다린다', k: 'steady' },
            { t: '입으면 기분 좋을 것 같으니 바로 산다', k: 'joy' },
            { t: '일주일 두고 보다가 아직 갖고 싶으면 산다', k: 'balance' },
            { t: '일단 결제하고 나중에 생각한다', k: 'spark' }
          ]
        },
        {
          q: '친구가 갑자기 "오늘 저녁 먹자"고 연락했다.',
          opts: [
            { t: '이번 달 식비 예산부터 확인한다', k: 'steady' },
            { t: '좋지, 이런 자리가 좋다', k: 'joy' },
            { t: '상황 봐서 괜찮으면 나간다', k: 'balance' },
            { t: '일단 나가고 본다', k: 'spark' }
          ]
        },
        {
          q: '월급날 가장 먼저 하는 일은?',
          opts: [
            { t: '고정지출 정리하고 저축부터 이체한다', k: 'steady' },
            { t: '갖고 싶던 것 하나를 산다', k: 'joy' },
            { t: '이번 달 계획을 대충 세운다', k: 'balance' },
            { t: '일단 쓰고 남으면 저축한다', k: 'spark' }
          ]
        },
        {
          q: '3만원짜리 물건이 5천원 할인한다는 알림이 왔다.',
          opts: [
            { t: '살 생각 없었으면 안 산다', k: 'steady' },
            { t: '마침 갖고 싶었으니 산다', k: 'joy' },
            { t: '정말 필요한지 한 번 더 본다', k: 'balance' },
            { t: '할인이라니 지금 아니면 손해다', k: 'spark' }
          ]
        },
        {
          q: '충동구매를 한 직후 가장 먼저 드는 생각은?',
          opts: [
            { t: '다음엔 더 꼼꼼히 보자', k: 'steady' },
            { t: '그래도 만족했으니 됐다', k: 'joy' },
            { t: '다음 달 지출을 조금 줄이면 된다', k: 'balance' },
            { t: '또 샀네… 하고 넘어간다', k: 'spark' }
          ]
        },
        {
          q: '여행 계획을 세울 때 나는?',
          opts: [
            { t: '항공·숙소 가격 비교표를 만든다', k: 'steady' },
            { t: '그곳에서 뭘 즐길지부터 찾는다', k: 'joy' },
            { t: '큰 틀만 정하고 나머지는 그때그때', k: 'balance' },
            { t: '마음에 들면 일단 결제, 계획은 나중', k: 'spark' }
          ]
        },
        {
          q: '친구가 받은 비싼 생일 선물 이야기를 들었다.',
          opts: [
            { t: '얼마짜리인지가 먼저 궁금하다', k: 'steady' },
            { t: '나도 이런 거 받으면 좋겠다', k: 'joy' },
            { t: '선물은 마음이지, 하고 넘긴다', k: 'balance' },
            { t: '나도 뭐 하나 사줘야겠다', k: 'spark' }
          ]
        },
        {
          q: '예상치 못한 지출(병원비 등)이 생겼다.',
          opts: [
            { t: '비상금에서 바로 처리한다', k: 'steady' },
            { t: '어쩔 수 없지, 다음에 아껴야지', k: 'joy' },
            { t: '다른 지출을 줄여서 맞춘다', k: 'balance' },
            { t: '일단 카드로 넘기고 나중에 고민한다', k: 'spark' }
          ]
        },
        {
          q: '같은 물건, 같은 가격인데 배송 조건만 다르다.',
          opts: [
            { t: '며칠 걸려도 무료배송을 고른다', k: 'steady' },
            { t: '빨리 오는 걸 고른다', k: 'joy' },
            { t: '급하면 빠른 배송, 아니면 무료', k: 'balance' },
            { t: '그냥 첫 번째로 뜬 걸 산다', k: 'spark' }
          ]
        },
        {
          q: '이번 달 지출을 돌아보면?',
          opts: [
            { t: '대체로 계획대로였다', k: 'steady' },
            { t: '즐거운 일에 썼다', k: 'joy' },
            { t: '무난하게 쓴 것 같다', k: 'balance' },
            { t: '생각보다 많이 썼다', k: 'spark' }
          ]
        }
      ],
      order: ['steady', 'joy', 'balance', 'spark'],
      types: {
        steady: {
          name: '알뜰 설계자',
          emoji: '🧮',
          summary: '숫자가 맞아야 마음이 편한 사람',
          desc: '쓰기 전에 한 번 더 계산합니다. 비교와 할인에 능하고, 계획한 지출은 미루지 않지만 계획에 없는 지출은 좀처럼 만들지 않아요. 덕분에 통장 잔고가 크게 흔들리는 일이 적습니다.',
          strengths: ['가격과 조건을 빠르게 비교한다', '예산 안에서 목표를 끝까지 이룬다', '예상 밖 지출에도 여유가 있다'],
          watch: ['좋아하는 것에도 기꺼이 쓰는 연습이 필요해요', '"싸게 샀다"가 목적이 되면 안 사는 게 최고입니다'],
          tip: '한 달에 한 번, 계획에 없던 "기분 전환비"를 정해 쓰면 만족도가 확 올라갑니다.'
        },
        joy: {
          name: '즐거움 수집가',
          emoji: '🎡',
          summary: '경험과 기분에 값을 매기는 사람',
          desc: '돈을 경험으로 바꾸는 데 거리낌이 없습니다. 좋은 자리, 맛있는 것, 새로운 시도에 지출이 몰리고 그만큼 기억도 많이 남아요. 다만 기분이 오르는 순간 결제도 함께 오릅니다.',
          strengths: ['삶의 질을 스스로 끌어올린다', '사람들과의 자리에서 후하다', '후회보다 만족을 남긴다'],
          watch: ['기분 기복이 지출 기복이 되기 쉬워요', '"이번 한 번만"이 자주 반복되지 않는지 봐야 합니다'],
          tip: '큰 지출만 하루 미루는 규칙 하나면, 즐거움은 그대로 두고 충동만 걸러집니다.'
        },
        balance: {
          name: '균형 조율가',
          emoji: '⚖️',
          summary: '필요하면 쓰고, 아니면 참는 사람',
          desc: '극단으로 가지 않습니다. 사고 싶은 것과 사야 하는 것 사이에서 적당한 선을 찾고, 지출이 넘치면 다른 곳에서 줄여요. 안정적이지만 가끔은 "그냥 갖고 싶어서" 사는 것도 필요합니다.',
          strengths: ['상황 판단이 빠르다', '과소비도 인색함도 없다', '주변과 맞추는 감각이 좋다'],
          watch: ['결정을 미루다 좋은 타이밍을 놓칠 수 있어요', '늘 중간만 고르면 취향이 흐려집니다'],
          tip: '한 분야만큼은 아낌없이 쓰는 "내 취향 예산"을 정해보세요.'
        },
        spark: {
          name: '즉흥 낭만러',
          emoji: '⚡',
          summary: '끌리면 일단 사고 보는 사람',
          desc: '계산보다 설렘이 먼저입니다. 결정이 빠르고 인생이 지루하지 않지만, 월말에 통장을 보면 놀라는 일이 있어요. 충동을 없애려 애쓰기보다 큰돈이 나가는 순간에만 장치를 걸어두면 됩니다.',
          strengths: ['결정이 빠르고 실행력이 좋다', '새로운 것을 두려워하지 않는다', '순간을 즐길 줄 안다'],
          watch: ['"할인이라서"가 구매 이유가 되기 쉬워요', '구독·소액결제가 새는 구멍이 됩니다'],
          tip: '카드 알림을 켜고 5만원 이상은 장바구니에 24시간 두는 것만으로 충분합니다.'
        }
      }
    },

    stress: {
      title: '스트레스 대처 유형 테스트',
      lead: '힘들 때 나는 어떻게 회복하는지 알아보는 테스트입니다.',
      minutes: '약 1분 30초',
      questions: [
        {
          q: '일이 꼬여 스트레스가 쌓였다. 가장 먼저 하는 일은?',
          opts: [
            { t: '원인을 정리하고 해결 순서를 짠다', k: 'solver' },
            { t: '누군가에게 하소연한다', k: 'venter' },
            { t: '잠깐 자리를 피해 쉰다', k: 'recharger' },
            { t: '믿는 사람에게 도움을 청한다', k: 'connector' }
          ]
        },
        {
          q: '중요한 발표나 시험 전날 밤, 나는?',
          opts: [
            { t: '마지막 점검 리스트를 만든다', k: 'solver' },
            { t: '떨린다고 누군가에게 말한다', k: 'venter' },
            { t: '일찍 자고 컨디션을 챙긴다', k: 'recharger' },
            { t: '같이 준비한 사람과 통화한다', k: 'connector' }
          ]
        },
        {
          q: '기분이 가라앉을 때 나를 살리는 것은?',
          opts: [
            { t: '문제를 하나씩 지워나가는 것', k: 'solver' },
            { t: '일기를 쓰거나 말로 털어놓는 것', k: 'venter' },
            { t: '산책·샤워·음악으로 머리를 비우는 것', k: 'recharger' },
            { t: '사람을 만나 이야기하는 것', k: 'connector' }
          ]
        },
        {
          q: '갑작스러운 일정 변경이 생겼다.',
          opts: [
            { t: '대안을 바로 짠다', k: 'solver' },
            { t: '짜증이 먼저 나서 말한다', k: 'venter' },
            { t: '일단 받아들이고 천천히 움직인다', k: 'recharger' },
            { t: '주변에 알리고 같이 맞춘다', k: 'connector' }
          ]
        },
        {
          q: '힘든 일이 끝난 직후 나는?',
          opts: [
            { t: '무엇이 문제였는지 되짚는다', k: 'solver' },
            { t: '다 털어놓고 나서 개운해진다', k: 'venter' },
            { t: '아무것도 안 하고 푹 쉰다', k: 'recharger' },
            { t: '고마운 사람들에게 연락한다', k: 'connector' }
          ]
        },
        {
          q: '생각이 다른 사람과 부딪혔을 때?',
          opts: [
            { t: '근거를 정리해 차분히 설명한다', k: 'solver' },
            { t: '감정을 솔직하게 표현한다', k: 'venter' },
            { t: '시간을 두고 거리를 둔다', k: 'recharger' },
            { t: '상대 입장을 먼저 물어본다', k: 'connector' }
          ]
        },
        {
          q: '나만의 회복 루틴에 가장 가까운 것은?',
          opts: [
            { t: '할 일을 체크리스트로 하나씩 지운다', k: 'solver' },
            { t: '수다 떨며 다 털어낸다', k: 'venter' },
            { t: '혼자 조용히 아무것도 안 한다', k: 'recharger' },
            { t: '좋아하는 사람과 시간을 보낸다', k: 'connector' }
          ]
        },
        {
          q: '누군가 "괜찮아?"라고 물어오면?',
          opts: [
            { t: '상황 설명부터 한다', k: 'solver' },
            { t: '"사실 좀 힘들어" 하고 털어놓는다', k: 'venter' },
            { t: '"괜찮아" 하고 넘긴다', k: 'recharger' },
            { t: '"물어봐줘서 고마워" 한다', k: 'connector' }
          ]
        }
      ],
      order: ['solver', 'venter', 'recharger', 'connector'],
      types: {
        solver: {
          name: '문제 해결형',
          emoji: '🧩',
          summary: '정리하면 풀린다',
          desc: '불안을 그대로 두지 못합니다. 상황을 나눠 적고 하나씩 처리하면서 마음이 안정되는 타입이에요. 실제로 문제를 줄이는 힘이 가장 큰 유형이지만, 풀 수 없는 일 앞에서는 더 괴로워할 수 있습니다.',
          strengths: ['문제를 구조화하는 능력이 뛰어나다', '위기에서 판단이 흐려지지 않는다', '주변이 믿고 맡기는 사람'],
          watch: ['해결할 수 없는 일은 더 붙잡고 있게 됩니다', '쉬는 것도 "할 일"로 만들어 버리곤 해요'],
          tip: '하루에 하나는 "오늘은 안 풀어도 되는 것"으로 정해두세요.'
        },
        venter: {
          name: '감정 표현형',
          emoji: '💬',
          summary: '말해야 가벼워진다',
          desc: '감정을 밖으로 꺼내야 정리가 됩니다. 말하거나 쓰는 과정에서 스스로 답을 찾는 경우가 많고, 주변 사람에게도 솔직한 편이에요. 다만 상대가 받아줄 준비가 안 된 순간에는 오해가 생기기도 합니다.',
          strengths: ['감정을 빨리 인식하고 표현한다', '털어놓고 나면 회복이 빠르다', '관계에서 솔직해 신뢰가 두텁다'],
          watch: ['같은 이야기를 반복하면 스스로 더 지칩니다', '듣는 사람의 컨디션도 살펴야 해요'],
          tip: '털어놓기 전에 "지금 들어줄 수 있어?" 한마디면 관계가 더 편해집니다.'
        },
        recharger: {
          name: '충전형',
          emoji: '🌿',
          summary: '비워야 다시 채워진다',
          desc: '혼자만의 시간으로 회복합니다. 잠깐 자리를 비우고, 아무것도 하지 않고, 몸을 쉬게 하면서 에너지를 채워요. 스스로를 지키는 힘이 좋지만, 그 시간이 길어지면 해야 할 일이 쌓여 더 무거워질 수 있습니다.',
          strengths: ['감정에 휩쓸리지 않고 가라앉힌다', '번아웃 신호를 빨리 알아챈다', '혼자서도 잘 견딘다'],
          watch: ['회피와 회복은 다릅니다. 미룬 일은 결국 옵니다', '힘들다는 신호를 너무 늦게 꺼내곤 해요'],
          tip: '쉬는 시간에 "언제 다시 볼지" 시각만 정해두면 회복이 미루기가 되지 않습니다.'
        },
        connector: {
          name: '관계 의지형',
          emoji: '🤝',
          summary: '혼자보다 같이',
          desc: '사람에게서 힘을 얻습니다. 힘들 때 도움을 청하는 데 거리낌이 없고, 주변과 함께 풀어가는 걸 자연스럽게 여겨요. 정서적 지지가 두텁지만, 상대의 사정을 살피지 않으면 관계가 소모될 수 있습니다.',
          strengths: ['도움을 요청하는 데 능하다', '주변을 자연스럽게 연결한다', '위로와 격려를 잘 건넨다'],
          watch: ['모두가 바쁠 때는 더 외롭게 느껴질 수 있어요', '기대가 어긋나면 서운함이 오래갑니다'],
          tip: '기댈 사람 목록을 셋으로 나눠두면, 한 사람에게 몰리지 않아 편안합니다.'
        }
      }
    }
  };

  var quizState = { key: 'spend', step: -1, answers: [] };
  var quizBody = $('#quiz-body');
  var quizCopyText = '';

  function quizCount() {
    return QUIZZES[quizState.key].questions.length;
  }

  function quizStart() {
    quizState.step = 0;
    quizState.answers = [];
    renderQuiz();
  }

  function quizAnswer(k) {
    /* 인트로(step -1)나 결과 화면에서는 응답을 받지 않는다 */
    if (quizState.step < 0 || quizState.step >= quizCount()) return;
    quizState.answers[quizState.step] = k;
    if (quizState.step < quizCount() - 1) {
      quizState.step += 1;
      renderQuiz();
    } else {
      quizState.step = quizCount();
      renderQuiz();
    }
  }

  function quizBack() {
    if (quizState.step > 0) {
      quizState.step -= 1;
      renderQuiz();
    }
  }

  function quizResult() {
    var quiz = QUIZZES[quizState.key];
    var tally = {};
    quiz.order.forEach(function (k) { tally[k] = 0; });
    quizState.answers.forEach(function (k) { if (k && tally[k] != null) tally[k] += 1; });

    var best = quiz.order[0];
    quiz.order.forEach(function (k) {
      if (tally[k] > tally[best]) best = k;
    });

    var total = quizState.answers.length || 1;
    return {
      type: quiz.types[best],
      key: best,
      share: Math.round((tally[best] / total) * 100),
      tally: tally
    };
  }

  function renderQuiz() {
    var quiz = QUIZZES[quizState.key];

    /* 인트로 */
    if (quizState.step === -1) {
      quizBody.innerHTML =
        '<div class="quiz-intro">' +
        '<div class="quiz-meta">' +
        '<span class="quiz-badge">' + quizCount() + '문항</span>' +
        '<span class="quiz-badge">' + quiz.minutes + '</span>' +
        '</div>' +
        '<h2 class="quiz-type">' + quiz.title + '</h2>' +
        '<p class="quiz-summary">' + quiz.lead + '</p>' +
        '<div class="quiz-actions" style="grid-template-columns:1fr">' +
        '<button type="button" class="btn" data-act="start">테스트 시작하기</button>' +
        '</div>' +
        '</div>';
      return;
    }

    /* 결과 */
    if (quizState.step >= quizCount()) {
      var r = quizResult();
      var t = r.type;
      quizBody.innerHTML =
        '<div class="quiz-result">' +
        '<div class="quiz-emoji">' + t.emoji + '</div>' +
        '<p class="quiz-summary">' + quiz.title + ' 결과</p>' +
        '<h2 class="quiz-type">' + t.name + '</h2>' +
        '<p class="quiz-summary">' + t.summary + '</p>' +
        '<div class="quiz-section"><h4>이런 사람이에요</h4><p class="quiz-text">' + t.desc + '</p></div>' +
        '<div class="quiz-section"><h4>강점</h4><ul class="quiz-list">' +
        t.strengths.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
        '</ul></div>' +
        '<div class="quiz-section"><h4>조심할 점</h4><ul class="quiz-list">' +
        t.watch.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
        '</ul></div>' +
        '<div class="fortune-block" style="margin-top:18px">' +
        '<h3 class="block-title">한 줄 조언</h3>' +
        '<p class="block-text">' + t.tip + '</p></div>' +
        '<div class="quiz-actions">' +
        '<button type="button" class="btn" data-act="copy">결과 복사하기</button>' +
        '<button type="button" class="btn btn-ghost" data-act="start">다시 하기</button>' +
        '<button type="button" class="btn btn-ghost" data-act="other">다른 테스트</button>' +
        '</div>' +
        '</div>';

      quizCopyText = [
        '🧠 ' + quiz.title + ' 결과 — 데일리툴',
        t.emoji + ' ' + t.name,
        t.summary,
        '강점: ' + t.strengths.join(' / '),
        '조심할 점: ' + t.watch.join(' / '),
        '한 줄 조언: ' + t.tip,
        'https://' + location.host + '/#quiz'
      ].join('\n');
      return;
    }

    /* 질문 */
    var q = quiz.questions[quizState.step];
    var pct = Math.round((quizState.step / quizCount()) * 100);

    quizBody.innerHTML =
      '<div class="quiz-head">' +
      '<div class="quiz-progress"><span class="quiz-bar" style="width:' + Math.max(pct, 4) + '%"></span></div>' +
      '<span class="quiz-count">' + (quizState.step + 1) + ' / ' + quizCount() + '</span>' +
      '</div>' +
      '<h2 class="quiz-q">' + q.q + '</h2>' +
      '<div class="quiz-opts">' +
      q.opts.map(function (o, i) {
        return '<button type="button" class="quiz-opt" data-k="' + o.k + '">' + o.t + '</button>';
      }).join('') +
      '</div>' +
      (quizState.step > 0 ? '<button type="button" class="quiz-back" data-act="back">← 이전 문항</button>' : '');
  }

  function switchQuiz(key) {
    if (!QUIZZES[key]) return;
    quizState = { key: key, step: -1, answers: [] };
    $$('.chip[data-quiz]').forEach(function (c) {
      var on = c.dataset.quiz === key;
      c.setAttribute('aria-selected', String(on));
      c.tabIndex = on ? 0 : -1;
    });
    renderQuiz();
  }

  function attachQuiz() {
    $$('.chip[data-quiz]').forEach(function (c) {
      c.addEventListener('click', function () { switchQuiz(c.dataset.quiz); });
    });

    quizBody.addEventListener('click', function (e) {
      var opt = e.target.closest('.quiz-opt');
      if (opt) { quizAnswer(opt.dataset.k); return; }

      var act = e.target.closest('[data-act]');
      if (!act) return;

      if (act.dataset.act === 'start') { quizStart(); }
      else if (act.dataset.act === 'back') { quizBack(); }
      else if (act.dataset.act === 'copy') { copyText(quizCopyText, act); }
      else if (act.dataset.act === 'other') {
        switchQuiz(quizState.key === 'spend' ? 'stress' : 'spend');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 개인정보처리방침 모달                                                */
  /* ------------------------------------------------------------------ */
  function attachPrivacy() {
    var dlg = $('#privacy-dialog');
    var openBtn = $('#open-privacy');
    var closeBtn = $('#close-privacy');
    if (!dlg) return;

    function open() {
      if (typeof dlg.showModal === 'function') {
        try { dlg.showModal(); return; } catch (e) { /* fallback */ }
      }
      dlg.setAttribute('open', '');
    }

    function close() {
      if (typeof dlg.close === 'function') {
        try { dlg.close(); return; } catch (e) { /* fallback */ }
      }
      dlg.removeAttribute('open');
    }

    if (openBtn) openBtn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    if (closeBtn) closeBtn.addEventListener('click', close);

    /* 바깥(배경) 클릭으로 닫기 */
    dlg.addEventListener('click', function (e) {
      if (e.target !== dlg) return;
      if (typeof dlg.close === 'function') { try { dlg.close(); return; } catch (err) { /* fallback */ } }
      dlg.removeAttribute('open');
    });
  }

  /* ------------------------------------------------------------------ */
  /* init                                                                */
  /* ------------------------------------------------------------------ */
  function init() {
    attachNumericInputs();
    attachPresets();
    attachPrivacy();
    attachCopy();
    attachSubscribe();

    /* 최근 계산 기록: 저장된 요약만 먼저 그린다 */
    historyItems = readStore();
    renderHistory();
    attachHistory();

    /* 연봉 */
    ['input', 'change'].forEach(function (evt) {
      salaryEls.annual.addEventListener(evt, function () { updateSalary(true); });
      salaryEls.nonTax.addEventListener(evt, function () { updateSalary(true); });
      salaryEls.deps.addEventListener(evt, function () { updateSalary(true); });
    });

    /* 대출 */
    ['input', 'change'].forEach(function (evt) {
      loanEls.amount.addEventListener(evt, function () { updateLoan(true); });
      loanEls.term.addEventListener(evt, function () { updateLoan(true); });
      loanEls.unit.addEventListener(evt, function () { updateLoan(true); });
      loanEls.rate.addEventListener(evt, function () { updateLoan(true); });
      loanEls.method.addEventListener(evt, function () { updateLoan(true); });
    });

    /* 퇴직금 */
    ['input', 'change'].forEach(function (evt) {
      sevEls.start.addEventListener(evt, function () { updateSeverance(true); });
      sevEls.end.addEventListener(evt, function () { updateSeverance(true); });
      sevEls.monthly.addEventListener(evt, function () { updateSeverance(true); });
      sevEls.bonus.addEventListener(evt, function () { updateSeverance(true); });
      sevEls.leave.addEventListener(evt, function () { updateSeverance(true); });
    });

    /* 주휴수당 */
    ['input', 'change'].forEach(function (evt) {
      wkEls.hourly.addEventListener(evt, function () { updateWeekly(true); });
      wkEls.hours.addEventListener(evt, function () { updateWeekly(true); });
    });

    /* 퍼센트 */
    $$('.chip[data-pmode]').forEach(function (c) {
      c.addEventListener('click', function () { setPercentMode(c.dataset.pmode); });
    });
    ['#p1-x', '#p1-y', '#p2-a', '#p2-b', '#p3-from', '#p3-to',
      '#p4-price', '#p4-rate', '#p5-price', '#p5-sale'].forEach(function (sel) {
        var el = $(sel);
        if (el) el.addEventListener('input', function () { updatePercent(true); });
      });

    /* 운세 */
    fortuneEls.today.textContent = '아래 ' + todayLabel() + ' 기준';
    fortuneEls.birth.addEventListener('change', renderFortune);
    fortuneEls.birth.addEventListener('input', renderFortune);
    fortuneEls.zodiac.addEventListener('change', renderFortune);
    fortuneEls.copy.addEventListener('click', copyFortune);

    /* 퀴즈 */
    attachQuiz();

    /* 최초 계산 (기록에는 남기지 않는다) */
    updateSalary();
    updateSeverance();
    updateWeekly();
    updateLoan();
    setPercentMode('p1');
    switchQuiz('spend');

    /* 해시 라우팅 */
    var hash = (location.hash || '').replace('#', '');
    if (TOOL_SECTION[hash]) {
      setTool(hash, { silent: true });
    } else {
      setTool('salary', { silent: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
