window.__ModuleLoader__.load({
  id: 'dsh-plugin-chat-handoff',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })

    const SLOT = 'conversation.session.header.actions'

    const BRANCH_PATHS = [
      'M 8 15 L 8 10',
      'M 8 10 C 8 8 6 6 4 6',
      'M 8 10 C 8 8 10 6 12 6',
      'M 4 6 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      'M 12 6 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      'M 8 15 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0'
    ]

    function BranchIcon({ size = 18 }) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, BRANCH_PATHS.map((d, i) => React.createElement('path', { key: i, d })))
    }

    const J = (o, n = 700) => { try { return JSON.stringify(o, (k, v) => (typeof v === 'function' ? '[fn]' : v), 1).slice(0, n) } catch (e) { return String(o) } }

    function normRole(t) {
      const r = (t.role || t.type || t.kind || t.author || '').toString().toLowerCase()
      if (r.includes('user') || r.includes('human')) return 'user'
      if (r.includes('assist') || r.includes('model') || r.includes('agent') || r.includes('bot')) return 'assistant'
      return 'other'
    }
    function normText(t) {
      if (typeof t === 'string') return t
      if (typeof t.text === 'string') return t.text
      if (typeof t.content === 'string') return t.content
      if (Array.isArray(t.content) || Array.isArray(t.parts) || Array.isArray(t.blocks)) {
        const arr = t.content || t.parts || t.blocks
        return arr.map(p => (typeof p === 'string' ? p : (p.text || p.content || ''))).join('\n')
      }
      return ''
    }

    // Служебные части сообщения: рассуждения модели, планы, черновики, вызовы тулов
    const REASONING_PART = /reason|think|thought|analy|scratch|draft|plan|tool/i

    // Текст из content-блока: ТОЛЬКО настоящие текстовые части.
    // Раньше при отсутствии текста брались все части подряд — так в заметку
    // утекали рассуждения. Теперь части reasoning/thinking/tool_* не читаются.
    function contentText(content) {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      const out = []
      for (const p of content) {
        if (typeof p === 'string') { out.push(p); continue }
        if (!p || typeof p !== 'object') continue
        const type = String(p.type || '').toLowerCase()
        if (type && type !== 'text') continue
        if (type && REASONING_PART.test(type)) continue
        if (typeof p.text === 'string' && p.text.trim()) out.push(p.text)
      }
      return out.join('\n')
    }

    // Записи eventSource → плоский список { role, text }
    function entriesToTurns(entries) {
      const seen = new Set()
      const turns = []
      for (const entry of entries) {
        const ev = entry && entry.event
        if (!ev) continue
        if (ev.seq !== undefined) { if (seen.has(ev.seq)) continue; seen.add(ev.seq) }
        const type = String(ev.type || '')
        const data = ev.data || {}
        let role = null, msg = null
        if (type === 'user/message') { role = 'user'; msg = data.message || data }
        else if (type === 'assistant/message') { role = 'assistant'; msg = data.message || data }
        else continue
        const text = contentText(msg && msg.content) || (typeof msg === 'string' ? msg : '')
        if (text.trim()) turns.push({ role, text })
      }
      return turns
    }

    // Записи eventSource → краткая сводка вызовов инструментов:
    // имя, путь, команда, ошибка. Нужна для «что реально делалось».
    function entriesToTools(entries) {
      const calls = new Map()
      const out = []
      for (const entry of entries) {
        const ev = entry && entry.event
        if (!ev) continue
        const data = ev.data || {}
        if (ev.type === 'tool/call') {
          let args = data.arguments
          if (typeof args === 'string') {
            try { args = JSON.parse(args) } catch (e) { args = {} }
          }
          calls.set(data.callId, { name: data.name || 'tool', args: args && typeof args === 'object' ? args : {} })
          continue
        }
        if (ev.type !== 'tool/result') continue
        const msg = data.message || data
        const call = calls.get(data.callId) || calls.get(msg.toolCallId) || {}
        const args = call.args || {}
        const path = (data.meta && data.meta.path) || args.file_path || args.path || ''
        const command = args.command || args.cmd || ''
        out.push({
          name: call.name || (msg.source && msg.source.kind) || 'tool',
          path: typeof path === 'string' ? path : '',
          command: typeof command === 'string' ? command : '',
          isError: !!(msg.isError || data.isError),
          text: flat(contentText(msg.content)).slice(0, 300),
        })
      }
      return out
    }

    // Последний вопрос человека мог остаться за окном истории: догружаем
    // не больше двух страниц и семи секунд, чтобы кнопка не висела.
    async function loadOlderHistory(ctx, sessionId) {
      try {
        const s = ctx && ctx.sessions
        const b = s && typeof s.binding === 'function' ? s.binding(sessionId) : null
        const sess = b && b.session
        if (!sess || typeof sess.loadOlder !== 'function') return 0
        const started = Date.now()
        let pages = 0
        while (pages < 2 && Date.now() - started < 7000) {
          const snap = sess.eventSource && typeof sess.eventSource.getSnapshot === 'function'
            ? sess.eventSource.getSnapshot() : null
          if (snap && !snap.hasMore) break
          if (sess.loadingOlder) break
          await sess.loadOlder()
          pages++
        }
        console.log('[chat-handoff] история догружена страниц: ' + pages)
        return pages
      } catch (e) {
        console.log('[chat-handoff] loadOlder не сработал: ' + e.message)
        return 0
      }
    }

    async function probeAndCollect(ctx, sessionId) {
      const log = (m, o) => console.log('[chat-handoff] ' + m, o === undefined ? '' : o)
      if (!ctx) { log('❌ ctx не передан в probeAndCollect'); return { turns: [], tools: [] } }
      if (!ctx.sessions) log('❌ ctx.sessions НЕТ — сервис sessions не доехал до плагина')
      const s = ctx.sessions || {}
      log('sessions API → binding:' + (typeof s.binding) + ', scopes:' + (typeof s.scopes) + ', manager:' + (typeof s.manager))
      log('sessionId из слота: ' + sessionId)

      const ids = []
      const addId = id => { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id) }
      addId(sessionId)
      if (!ids.length) {
        try {
          const href = String(location.href) + String(location.hash || '')
          const m = href.match(/session-[A-Za-z0-9_-]+/)
          if (m) { addId(m[0]); log('sessionId из URL: ' + m[0]) }
        } catch (e) { log('url: ' + e.message) }
      }
      try {
        const sc = s.scopes
        if (sc && typeof sc.keys === 'function') {
          const ks = [...sc.keys()]
          log('открытых scope: ' + ks.length, ks)
          ks.forEach(addId)
        }
      } catch (e) { log('scopes: ' + e.message) }
      log('кандидаты sessionId:', ids)
      if (!ids.length) log('❌ кандидатов sessionId ноль — слот не дал id, URL не дал, scopes пусты')

      const sources = []
      const addES = (label, es) => {
        if (es && typeof es.getSnapshot === 'function' && !sources.some(x => x[1] === es)) sources.push([label, es])
      }
      for (const id of ids) {
        const short = id.slice(0, 22)
        try {
          const b = s.binding && s.binding(id)
          if (b) { log(`binding(${short}) keys:`, Object.keys(b)); addES('binding.eventSource', b.eventSource) }
        } catch (e) { log('binding err: ' + e.message) }
        try {
          const rec = s.scopes && s.scopes.get(id)
          if (rec) {
            log(`scope(${short}) keys:`, Object.keys(rec))
            addES('scope.session.eventSource', rec.session && rec.session.eventSource)
            addES('scope.eventSource', rec.eventSource)
            addES('scope.binding.eventSource', rec.binding && rec.binding.eventSource)
          }
        } catch (e) { log('scope err: ' + e.message) }
        try {
          const sess = s.manager && s.manager.get && s.manager.get(id)
          if (sess) addES('manager.get.eventSource', sess.eventSource)
        } catch (e) { log('manager.get err: ' + e.message) }
      }
      log('источников событий: ' + sources.length)
      if (!sources.length) log('❌ ни у одного кандидата не нашлось eventSource с getSnapshot')

      for (const [label, es] of sources) {
        let snap
        try { snap = es.getSnapshot() } catch (e) { log(label + ': getSnapshot err ' + e.message); continue }
        const entries = (snap && snap.entries) || []
        log(label + ': entries=' + entries.length + ' hasMore=' + !!(snap && snap.hasMore))
        if (!entries.length) continue
        log('  пример entry:', J(entries[0], 400))
        const turns = entriesToTurns(entries)
        const tools = entriesToTools(entries)
        log('  ходов из него: ' + turns.length + ', инструментов: ' + tools.length)
        if (turns.length) {
          log(`✅ ИСТОРИЯ: ${label} → ${turns.length} ходов, ${tools.length} инструментов`)
          return { turns, tools }
        }
      }

      log('историю найти не удалось')
      return { turns: [], tools: [] }
    }

    // ---------- ДАЙДЖЕСТ ----------
    // Итог, а не хроника: «проблема → как решена», что осталось, понятия, где что лежит.
    // Рассуждения, планы, «могу/далее» и служебные блоки сюда не попадают.

    const NOISE_LINE = /^\s*(?:ок|okay|ok|хорошо|понял|поняла|спасибо|да|cool|great|sure|конечно|давай|давайте|вот)\b/i
    // Намерения, планы, вопросы к пользователю: это не результат
    const PLAN_LINE = /^(?:следующ|дальше|далее|потом|затем|могу|мог бы|предлаг|рекоменд|стоит |можно (?:бы|ещё|еще)|хочу|планир|надо буд|нужно буд|если хочешь|вариант|выбер|скажи|уточн)/i
    // Незакрытый хвост: работа, которая действительно не сделана
    const OPEN_LINE = /(остал(?:ось|ась|ся|и)(?=\s+[а-яёa-z№\d])|не сделан|не готов|не проверен|не проверял|ещё не|еще не|не удалось|не получилось|не дописан|не закрыт|в работе|не протестирован|не запускал|не переустанов|не установлен|не решено)/i
    // Ход работы, а не результат: «Let me…», «Теперь посмотрю…», «Хватит планировать…»
    const NARRATION = /^(?:let me|let's|now i|i'll|i will|i've|i need to|i'm going|first,? i|next,? i|looking at|checking|reading|проверяю|просматриваю|смотрю|читаю|хватит|перейду|перейдём|перейдем|ладно|окей|хорошо,|итак)\b/i
    // Что точно означает готовый итог — чтобы «теперь …» не путать с «теперь посмотрю»
    const STRONG_OUTCOME = /(исправлен|исправил|почин|поправил|решено|решена|решён|решены|заработал|работает|готово|готов |сделал|сделано|установлен|установил|поставлен|поставил|собран|собрал|обновлён|обновлен|обновил|добавлен|добавил|удалён|удален|удалил|заменён|заменен|заменил|поменял|переписал|перенёс|перенес|подключён|подключен|подключил|убрал|применил|переустановил|перезапустил|проверен|подтверждён|подтвержден)/i
    // Чем закончилось
    const OUTCOME_LINE = /(исправлен|почин|решено|решена|решён|заработал|заработает|работает|готово|готов|установлен|поставлен|собран|обновлён|обновлен|переименован|добавлен|удалён|удален|перенесён|перенесен|заменён|заменен|подключён|подключен|проверен|подтверждён|подтвержден|теперь|оказалось|причина|дело в|ошибка (?:была|был|в)|в итоге|итог|вывод)/i
    const FENCE = /```[\s\S]*?```/g

    // Проблема в вопросе
    const PROBLEM_MARK = /(не работает|не работают|не работал|не появл|не откр|не груз|ошибк|падает|сломал|битый|не хватает|не мог|проблем|баг|тормоз|не так\b|не вижу|не нашёл|не нашел|не находи|не удаёт|не удает|не запуска|не ставится|криво|завис|слетел|не сохраня)/i

    // Домен: код или учёба — от него зависят заголовки и способ подачи
    const CODE_WORD = /(плагин|код|файл|сборк|собрат|npm|pnpm|node|dsh |powershell|\.ps1|\.js\b|\.json|репозитор|коммит|ветк|верси|установк|терминал|лог|ошибк)/gi
    const STUDY_WORD = /(параграф|§|глава|учебник|задачник|упражнени|билет|конспект|лекци|теорем|формул|урок|курс|stepik|задани[ея]|задач[аиу]|пример[ыа]?\s*№)/gi

    // Служебные вставки в сообщениях пользователя: без них в заметку лез мусор
    const NOISE_BLOCK = [
      /This is an automatically generated checkpoint[\s\S]*$/i,
      /Current runtime context\.[\s\S]*$/i,
      /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
      /<available_skills>[\s\S]*?<\/available_skills>/gi,
      /<environment_context>[\s\S]*?<\/environment_context>/gi,
      /<compacted-summary>[\s\S]*?<\/compacted-summary>/gi,
      /\[MNEMON\][\s\S]*$/i,
    ]
    // Служебные «сообщения» от самой среды: это не вопросы пользователя
    const HARNESS_TURN = /(MNEMON|Runtime context|system-reminder|available_skills|automatically generated checkpoint|Current working directory|Current DSH|Time sampled while preparing turn|^\s*<!)/i

    function cleanUser(s) {
      let t = String(s || '')
      for (const re of NOISE_BLOCK) t = t.replace(re, ' ')
      return t.trim()
    }
    function isHarnessTurn(s) {
      const raw = String(s || '')
      return HARNESS_TURN.test(raw) || !cleanUser(raw)
    }

    const PATH_RE = /(?:[A-Za-z]:\\[^\s`"'«»()\[\]<>,;]+|(?:[\w.-]+[\\/])+[\w.-]+\.(?:js|ts|tsx|jsx|json|ya?ml|ps1|cmd|md|py|tex|docx|xlsx|pptx|tgz|zip|txt))/g

    function flat(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
    function uniq(arr) {
      const seen = new Set()
      return arr.filter(x => {
        const k = String(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 70)
        if (!k || seen.has(k)) return false
        seen.add(k)
        return true
      })
    }

    // Строки ответа без кода, маркеров списка и markdown-разметки
    function linesOf(a) {
      return String(a || '')
        .replace(FENCE, '\n')
        .split('\n')
        .map(raw => flat(String(raw)
          .replace(/^[-*•–—]\s+/, '')
          .replace(/^\d+[.)]\s+/, '')
          .replace(/^#{1,6}\s+/, '')
          .replace(/\*\*|__|`/g, '')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[[\]]/g, '')))
        .filter(Boolean)
    }

    // Итог обычно уложен в одну фразу
    function clauseList(l) {
      return String(l || '').split(/(?<=[.!?;])\s+/).map(flat).filter(Boolean)
    }

    const STOP = new Set(['это', 'как', 'что', 'чтобы', 'для', 'под', 'над', 'про', 'всё', 'все', 'так', 'там', 'тут', 'уже', 'ещё', 'еще', 'если', 'или', 'мне', 'меня', 'мой', 'моя', 'моё', 'наш', 'его', 'её', 'ее', 'их', 'был', 'была', 'было', 'быть', 'есть', 'нет', 'надо', 'нужно', 'можно', 'давай', 'пожалуйста', 'который', 'которая', 'которые', 'при', 'без', 'через', 'после', 'перед', 'тоже', 'очень', 'только', 'этот', 'эта', 'эти', 'она', 'они', 'оно'])
    // Ключ темы: по нему ходы схлопываются в одну строку
    function keyOf(s) {
      return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
        .filter(w => w.length > 2 && !STOP.has(w)).slice(0, 3).join(' ')
    }

    // Вопрос → ярлык проблемы без «сделай/давай/может/проверь»
    // \b не работает для кириллицы, поэтому конец слова — просмотр вперёд
    const ASK_PREFIX = /^(?:(?:а|и|ну|вот|так|ок|окей|пожалуйста|может|давай|давайте|надо|нужно|хочу|сделай|сделайте|исправь|поправь|добавь|убери|поменяй|проверь|посмотри|объясни|скажи|переделай|оптимизируй)(?=[\s,:—.\-]|$)[\s,:—.\-]*)+/i
    // Просьба хвостом: «кнопка не появляется, посмотри почему» → «кнопка не появляется»
    const ASK_TAIL = /[,;—-]?\s*(?:посмотри|погляди|проверь|глянь|объясни|скажи|покажи|плиз|пожалуйста)(?=[\s.,!?]|$)[\s\S]*$/i
    function shortAsk(q) {
      let t = flat(cleanUser(q).replace(/[*`#>|]+/g, ' '))
      t = t.replace(ASK_PREFIX, '').replace(ASK_TAIL, '')
      if (t.length < 6) return ''
      const first = t.split(/(?<=[.!?])\s+/)[0] || t
      const s = flat(first.replace(/[?!.]+$/, ''))
      if (s.length < 6) return ''
      return s.length > 90 ? s.slice(0, 87) + '…' : s
    }

    // Выше — итог, ниже — шаг, план или вопрос
    function outcomeScore(l) {
      if (!l || l.length < 20) return -99
      if (NOISE_LINE.test(l)) return -99
      // рассказ о ходе («Let me…», «Проверяю…») — не итог, если в нём нет признака готового результата
      if (NARRATION.test(l) && !STRONG_OUTCOME.test(l)) return -99
      let sc = 0
      if (OUTCOME_LINE.test(l)) sc += 2
      if (/^(?:исправлен|исправил|поправил|почин|решено|решены|готово|сделал|сделано|установил|поставил|собрал|обновил|добавил|удалил|заменил|поменял|переписал|подключил|убрал|применил|теперь|оказалось|причина|дело в|в итоге|итог|вывод)/i.test(l)) sc += 2
      if ((l.match(PATH_RE) || []).length || /\d+\.\d+\.\d+/.test(l)) sc += 1
      if (PLAN_LINE.test(l)) sc -= 3
      if (OPEN_LINE.test(l)) sc -= 2
      if (/\?\s*$/.test(l)) sc -= 4
      if (l.length > 240) sc -= 2
      if (/(могу |дай знать|если нужно|на выбор|вариант[ыа]? |продолжай)/i.test(l)) sc -= 2
      return sc
    }

    // Итог хода: одна фраза ответа, лучшая по оценке (min — порог отсечения шагов)
    function pickFix(a, min = 1) {
      let best = '', bestSc = min
      for (const l of linesOf(a)) {
        for (const c of clauseList(l)) {
          const sc = outcomeScore(c)
          if (sc > bestSc) { bestSc = sc; best = c }
        }
      }
      if (!best) return ''
      // «Оказалось/причина» — диагноз, а не способ решения: ищем строку с действием
      if (/^(?:оказалось|причина|дело в|проблема (?:была|в))/i.test(best)) {
        const acts = /\b(?:исправлен|исправил|поменял|заменил|переписал|добавил|удалил|перенёс|вынес|беру|берём|взял|сделал|подключил|поставил|собрал|применил|переустановил|обновил|убрал|поправил)/i
        let hit = ''
        for (const l of linesOf(a)) {
          for (const c of clauseList(l)) {
            if (c.length >= 14 && outcomeScore(c) > -50 && acts.test(c)) { hit = c; break }
          }
          if (hit) break
        }
        if (hit) best = hit
      }
      return best
        .replace(/^(?:итог|итого|вывод|результат)\s*[:—-]\s*/i, '')
        .replace(/^(?:и|а|но|вот|так)\s+/i, '')
        .replace(/[;,]?\s*(?:это всё|готово)\.?$/i, '')
        .trim()
    }

    // Что осталось незакрытым
    function pickLeft(a) {
      const out = []
      for (const l of linesOf(a)) {
        for (const c of clauseList(l)) {
          if (c.length < 14 || c.length > 200) continue
          if (!OPEN_LINE.test(c)) continue
          if (/\?\s*$/.test(c) || PLAN_LINE.test(c)) continue
          // «Осталось разобраться, как это устроено» — не работа, а ход мысли
          // «Сделал три слоя: РЕШЕНО / ОСТАЛОСЬ / СОСТОЯНИЕ» — описание заголовков, а не работа
          if (/решено|пройдено/i.test(c) && /осталось/i.test(c)) continue
          // описание исправления («больше не попадает», «раньше ловилось») — не незакрытая работа
          if (/больше не|не попадают|раньше (?:ловил|считал|был)|нужен явный признак|осталось\s*№\s*\d+/i.test(c)) continue
          if (NARRATION.test(c) || /^(?:осталось (?:понять|разобраться|выяснить|решить, что))/i.test(c)) continue
          if (c.split(' ').length < 3) continue
          out.push(c
            .replace(/^(?:но|однако|при этом|и)\s+/i, '')
            .replace(/^(?:осталось(?: только| ещё)?|ещё (?:надо|нужно)|дальше|потом)\s*[:—-]?\s*/i, '')
            .replace(/^([а-яё])/, (m) => m.toUpperCase()))
        }
      }
      return out
    }

    // Фраза начинается с действия — это рассказ о ходе, а не определение
    const KEY_SKIP = /^(?:собрал|сделал|поставил|исправил|поменял|заменил|переписал|добавил|удалил|перенёс|беру|берём|взял|подключил|применил|обновил|убрал|поправил|проверил|смотрю|теперь|оказалось|причина|осталось)/i

    // Понятия: команды и идентификаторы в бэктиках + предложения-определения
    function pickKeys(a) {
      const out = []
      const body = String(a || '')
      for (const m of body.match(/`[^`\n]{3,60}`/g) || []) {
        const v = flat(m.slice(1, -1))
        if (v.split(' ').length > 6) continue
        if (/^(?:true|false|null|undefined|\d+)$/i.test(v)) continue
        out.push(v)
      }
      for (const l of linesOf(body)) {
        for (const c of clauseList(l)) {
          if (c.length < 26 || c.length > 150) continue
          if (PLAN_LINE.test(c) || OPEN_LINE.test(c) || /\?\s*$/.test(c)) continue
          // обрывок хода («Собрал tgz … — это копия») — не понятие
          if (KEY_SKIP.test(c)) continue
          if (NARRATION.test(c) && !STRONG_OUTCOME.test(c)) continue
          if (/(— это|это —|называется|означает|работает через|состоит из|отвечает за|нужн\w* для|используется для|представляет собой)/i.test(c)) out.push(c)
        }
      }
      return uniq(out)
    }

    // Где что лежит: пути файлов (последнее упоминание считается текущим)
    function pickPaths(text) {
      const out = []
      for (const m of String(text).match(PATH_RE) || []) {
        const p = flat(m).replace(/[*`]+$/, '').replace(/[.,;:)\]!?]+$/, '').trim()
        if (p.length < 4 || /:\/\//.test(p)) continue
        if (/…|\.\.\.|<|>|^\$/.test(p)) continue // шаблоны и усечённые пути — не место
        out.push(p)
      }
      return out
    }

    function pickVersions(text) {
      const out = []
      for (const m of String(text).match(/(?:верси\w*|version|v)\s*[:=—-]?\s*v?(\d+\.\d+\.\d+)/gi) || []) {
        const v = /(\d+\.\d+\.\d+)/.exec(m)
        if (v) out.push(v[1])
      }
      return out
    }

    function pickCommands(text) {
      const out = []
      for (const m of String(text).match(/(?:dsh|pnpm|npm|node|git|pwsh|powershell)\s+(?:plugin|install|add|remove|uninstall|run|build|pack|publish|commit|push|status)\b[^\n`]{0,80}/gi) || []) {
        const c = flat(m).replace(/[.,;:]+$/, '')
        if (c.length >= 12 && c.length <= 140) out.push(c)
      }
      return out
    }

    // Учёба: какие параграфы и номера задач вообще звучали
    function pickTopics(text) {
      const out = []
      for (const m of String(text).match(/(?:§|параграф[\p{L}]*|тем[аы]|глав[аы]|раздел[\p{L}]*)\s*№?\s*(\d{1,3})/giu) || []) {
        const n = /(\d{1,3})/.exec(m)
        if (n) out.push(n[1])
      }
      return [...new Set(out)]
    }
    function pickTasks(text) {
      const out = []
      for (const m of String(text).match(/(?:задач[\p{L}]*|упражнени[\p{L}]*|пример[\p{L}]*|номер[\p{L}]*|№)\s*№?\s*(\d{1,3}(?:\s*[,–—-]\s*\d{1,3})*)/giu) || []) {
        const n = /(\d{1,3}(?:\s*[,–—-]\s*\d{1,3})*)/.exec(m)
        if (n) out.push(n[1].replace(/\s+/g, ''))
      }
      return [...new Set(out)]
    }

    // Инструменты: ошибки, изменённые файлы, команды. Для итога важнее
    // последние ошибки и то, что реально писалось на диск.
    const WRITE_TOOL = /(write|edit|patch|create|delete|remove|move|rename|apply)/i
    const IMPORTANT_ERROR = /^(?:bash|shell|write|edit|patch|apply|create|delete|remove|move|rename|run|test|build|install)/i
    function toolSummary(tools) {
      const errors = [], changed = [], cmds = []
      for (const t of (tools || []).slice(-120)) {
        if (!t) continue
        if (t.isError && IMPORTANT_ERROR.test(t.name)) {
          const head = t.name + (t.path ? ' ' + t.path : '')
          errors.push((head + ': ' + (t.text || 'ошибка')).slice(0, 200))
        }
        if (t.path && WRITE_TOOL.test(t.name)) changed.push(t.path)
        if (t.command) {
          const cmd = flat(t.command)
          if (cmd && cmd.length <= 140 && !/[\n\r;|]|&&/.test(t.command) &&
            /^(?:npm|pnpm|yarn|node|git|dsh|python|pytest|cargo|go|dotnet|make|cmake)\b/i.test(cmd)) cmds.push(cmd)
        }
      }
      return {
        errors: uniq(errors).slice(-3),
        changed: uniq(changed).slice(-6),
        cmds: uniq(cmds).slice(-3),
      }
    }

    // Три слоя: что решено → что осталось → где что лежит.
    // Пары «вопрос-шаг» схлопываются: на одну тему одна строка «проблема → итог».
    function buildDigest(input, toolList) {
      const turns = Array.isArray(input) ? input : ((input && input.turns) || [])
      const tools = Array.isArray(toolList) ? toolList : ((input && input.tools) || [])
      const pairs = []
      let cur = null
      let orphan = null
      let lastHuman = ''
      let lastAnswer = ''
      let lastHumanAt = -1
      let lastAnswerAt = -1
      turns.forEach((t, i) => {
        const role = normRole(t), text = normText(t).trim()
        if (!text || role === 'other') return
        if (role === 'user') {
          // служебная вставка среды или пустой текст после чистки — это не просьба человека
          if (isHarnessTurn(text)) return
          const human = cleanUser(text)
          if (!shortAsk(human)) return
          lastHuman = human
          lastHumanAt = i
          cur = { question: human, answer: '' }; pairs.push(cur)
        } else if (cur) {
          cur.answer += (cur.answer ? '\n' : '') + text
          lastAnswer = text
          lastAnswerAt = i
        }
        else {
          // ответ без вопроса: промпт остался за границей загруженной истории — не теряем итог
          if (!orphan) { orphan = { question: '', answer: '' }; pairs.push(orphan) }
          orphan.answer += (orphan.answer ? '\n' : '') + text
          lastAnswer = text
          lastAnswerAt = i
        }
      })
      const live = pairs.filter(p => p.answer.trim()) // ход без ответа — не «сделано»
      const recent = live.slice(-1)
      const pending = lastHumanAt > lastAnswerAt
      const T = toolSummary(tools)
      const conclusionFull = flat(lastAnswer)
      const conclusion = conclusionFull.length > 600
        ? conclusionFull.slice(0, 600).trimEnd() + '…'
        : conclusionFull

      const allQ = recent.map(p => p.question).join('\n')
      const all = allQ + '\n' + recent.map(p => p.answer).join('\n')
      const studyHits = (all.match(STUDY_WORD) || []).length
      const codeHits = (all.match(CODE_WORD) || []).length + (all.match(PATH_RE) || []).length * 2
      const study = studyHits >= 4 && studyHits * 2 > codeHits

      const solved = [], left = [], keys = [], paths = [], vers = [], cmds = []
      const byTopic = new Map()

      recent.forEach(p => {
        const head = shortAsk(p.question)
        const fix = flat(pickFix(p.answer) || pickFix(p.answer, 0)).slice(0, 190)
        if (fix) {
          const k = keyOf(head) || keyOf(fix)
          if (!k) {
            solved.push([head, fix].filter(Boolean).join(' → '))
          } else {
            const prev = byTopic.get(k)
            if (prev) { prev.fix = fix; prev.hits++ } // актуальный итог — последний
            else byTopic.set(k, { head, fix, hits: 1 })
          }
        } else if (head && PROBLEM_MARK.test(cleanUser(p.question))) {
          // просьба, из которой не вытащить итог, честно остаётся в «осталось»
          if (head.length >= 20 && head.split(' ').length >= 3) left.push(head + ' — в ветке не закрыто')
        }
        pickLeft(p.answer).forEach(x => left.push(x))
        pickKeys(p.answer).forEach(x => keys.push(x))
        pickPaths(p.answer).forEach(x => paths.push(x))
        pickVersions(p.answer).forEach(x => vers.push(x))
        pickCommands(p.answer).forEach(x => cmds.push(x))
      })
      T.changed.forEach(p => paths.push(p))
      if (pending && shortAsk(lastHuman)) left.push('в работе: ' + shortAsk(lastHuman))

      // Одна тема — одна строка: «проблема → как решена»
      byTopic.forEach(v => {
        if (!v.head) { solved.push(v.fix); return }
        const kh = keyOf(v.head)
        solved.push(kh && keyOf(v.fix).startsWith(kh) ? v.fix : v.head + ' → ' + v.fix)
      })

      // Учёба: параграф и задачи проговариваются явно
      if (study) {
        pickTopics(allQ).slice(-8).forEach(n => solved.push('§' + n + ' — пройден'))
        const tk = pickTasks(allQ).slice(-6)
        if (tk.length) solved.push('решались задачи: №' + tk.join(', №'))
      }

      const S = uniq(solved).slice(-10)
      const L = uniq(left).slice(-5)
      const K = uniq(keys).filter(k => k.length >= 8 &&
        !/^(?:не |сделаем|сделаю|теперь|это |осталось|остальн|нужен )/i.test(k)).slice(0, 4)
      const hasSomething = S.length || L.length || K.length || T.errors.length || T.changed.length || conclusion.length >= 20
      if (!hasSomething) return null // пустую ветку не открываем

      // Состояние: где что лежит — файлы, версия, команды, понятия
      const byName = new Map()
      paths.forEach(p => byName.set(String(p).split(/[\\/]/).pop().toLowerCase(), p))
      const P = [...byName.values()].slice(-6)
      const V = uniq(vers).slice(-2)
      const C = uniq(cmds.concat(T.cmds)).slice(-3)

      const state = []
      if (T.changed.length) state.push('изменено: ' + T.changed.join(', '))
      if (P.length) state.push((study ? 'материалы: ' : 'файлы: ') + P.join(', '))
      if (V.length) state.push('версия: ' + V.join(', '))
      if (C.length) state.push('запуск: ' + C.join(' | '))
      if (K.length) state.push('понятия: ' + K.join('; '))

      const goal = shortAsk(lastHuman) || (recent[0] && shortAsk(recent[0].question)) || ''
      const section = (title, items) =>
        items.length ? title + '\n' + items.map(i => '- ' + i).join('\n') + '\n\n' : ''

      let d = '🌿 HANDOFF — ИТОГ ВЕТКИ\n'
      if (goal) d += '🎯 Задача: ' + goal + '\n'
      d += '\n'
      if (conclusion.length >= 20) d += '📌 ПОСЛЕДНИЙ ВЫВОД:\n' + conclusion + '\n\n'
      d += section((study ? '✅ ПРОЙДЕНО' : '✅ РЕШЕНО') + ' (' + S.length + '):', S)
      d += section('⏳ ОСТАЛОСЬ (' + L.length + '):', L)
      d += section('⚠️ ОШИБКИ ИНСТРУМЕНТОВ (' + T.errors.length + '):', T.errors)
      if (state.length) d += (study ? '📚 МАТЕРИАЛ:\n' : '📂 СОСТОЯНИЕ:\n') + state.map(s => '· ' + s).join('\n') + '\n\n'
      d += '(Это итог, а не хроника: промежуточные шаги опущены. Продолжай с учётом этого.)'
      return d.replace(/\n{3,}/g, '\n\n').trim()
    }

    let propsLogged = false

    function HandoffButton(props) {
      const { ctx } = props
      const sessionId = props.sessionId
      const [hover, setHover] = React.useState(false)
      const [loading, setLoading] = React.useState(false)

      // Один раз при первом рендере: что реально приходит в компонент
      if (!propsLogged) {
        propsLogged = true
        try {
          const keys = Object.keys(props)
          console.log('[chat-handoff] ВСЕ props кнопки (' + keys.length + '):', keys)
          keys.forEach(k => {
            let v = props[k]
            const t = typeof v
            let shown
            if (t === 'function') shown = '[function]'
            else if (t === 'string' || t === 'number' || t === 'boolean' || v == null) shown = v
            else shown = J(v, 300)
            console.log('[chat-handoff]   props.' + k + ' (' + t + ') =', shown)
          })
          console.log('[chat-handoff] sessionId из props:', sessionId)
          console.log('[chat-handoff] useSession в props:', typeof props.useSession, ' useProjection:', typeof props.useProjection)
        } catch (e) { console.log('[chat-handoff] лог props упал: ' + e.message) }
      }

      const handleClick = async () => {
        setLoading(true)
        try {
          console.log('[chat-handoff] props кнопки:', Object.keys(props))
          const pages = await loadOlderHistory(ctx, sessionId)
          const { turns, tools } = await probeAndCollect(ctx, sessionId)
          console.log('[chat-handoff] история: страниц ' + pages + ', turns=' + turns.length + ', tools=' + tools.length)
          const digest = buildDigest(turns, tools)

          if (!digest) {
            console.log('[chat-handoff] ❌ digest не собран: turns=' + turns.length + ', tools=' + tools.length)
            alert('Нечего переносить: в этой ветке нет ни текстовых ответов, ни результатов инструментов.')
            return
          }
          console.log('[chat-handoff] DIGEST:\n' + digest)

          if (ctx.uiWorkspace && typeof ctx.uiWorkspace.startSession === 'function') {
            await ctx.uiWorkspace.startSession(undefined, { prompt: digest, clearPreviousDraft: true })
          } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(digest)
            alert('Конспект скопирован в буфер обмена!')
          } else {
            console.log('[chat-handoff] ❌ ни uiWorkspace.startSession, ни clipboard.writeText недоступны')
            alert('Не могу открыть ветку и не могу скопировать — смотри консоль.')
          }
        } catch (e) {
          console.error('[chat-handoff] Error:', e)
          alert('Ошибка handoff: ' + e.message)
        } finally {
          setLoading(false)
        }
      }

      return React.createElement('button', {
        type: 'button', title: 'Перенести в другую ветку', 'aria-label': 'Handoff',
        onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
        onClick: handleClick, disabled: loading,
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, padding: 0,
          border: 'none', borderRadius: 6, background: hover ? 'var(--tint-bg, rgba(0,0,0,0.1))' : 'transparent',
          color: hover ? 'var(--tint, #fff)' : 'inherit', opacity: loading ? 0.5 : 1, cursor: 'pointer', transition: 'all 0.2s',
        },
      }, loading ? '...' : React.createElement(BranchIcon, { size: 18 }))
    }

    module.exports.inject = ['slots', 'uiWorkspace', 'sessions']
    module.exports.apply = (ctx) => {
      if (!ctx) { console.log('[chat-handoff] ❌ apply без ctx'); return }
      if (!ctx.slots) { console.log('[chat-handoff] ❌ ctx.slots НЕТ — плагин не может зарегистрировать кнопку'); return }
      ctx.slots.inject(SLOT, () => {
        const spec = typeof ctx.slots.spec === 'function' ? ctx.slots.spec(SLOT) : undefined
        console.log('[chat-handoff] слот ' + SLOT + ' → scope=' +
          (spec && spec.scope ? J(spec.scope, 200) : 'spec не найден'))

        const component = (props) => React.createElement(HandoffButton, Object.assign({ ctx }, props || {}))
        const dispose = ctx.slots.register({ name: SLOT, id: 'chat-handoff', order: 10 }, component)
        console.log('[chat-handoff] ✅ зарегистрировано в ' + SLOT)
        return dispose
      })
    }

    // Для проверки сборки дайджеста вне браузера (в UI не используется)
    module.exports.__test = { buildDigest, entriesToTurns, entriesToTools, toolSummary, cleanUser }

    return module.exports
  },
})