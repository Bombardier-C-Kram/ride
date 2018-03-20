// represents the main screen of a connected RIDE
// holds refs to the session (.win[0]), editors/tracers (.win[i])
// and an instance of the workspace explorer (.wse) defined in wse.js
// manages the language bar, its tooltips, and the insertion of characters
// processes incoming RIDE protocol messages
D.IDE = function IDE(opts = {}) {
  const ide = this;
  I.cn.hidden = 1;
  this.lbarRecreate();
  D.ide = ide;
  ide.dom = I.ide; I.ide.hidden = 0;
  ide.floating = opts.floating;
  ide.ipc = opts.ipc;
  // lines to execute: AtInputPrompt consumes one item from the queue, HadError empties it
  ide.pending = [];
  ide.exec = (a, tc) => {
    if (a && a.length) {
      tc || (ide.pending = a.slice(1));
      D.send('Execute', { trace: tc, text: `${a[0]}\n` });
      ide.getThreads(); ide.getSIS();
    }
  };
  ide.host = ''; ide.port = ''; ide.wsid = '';
  D.prf.title(ide.updTitle.bind(ide));
  ide.wins = {};
  if (ide.floating) {
    ide.connected = 1;
    this._focusedWin = null;
    Object.defineProperty(ide, 'focusedWin', {
      set(w) {
        ide.ipc.emit('focusedWin', w.id);
        this._focusedWin = w;
      },
      get() { return this._focusedWin; },
    });
    ide.switchWin = (x) => { ide.ipc.emit('switchWin', x); };
  } else {
    ide.wins[0] = new D.Se(ide);
    D.wins = ide.wins;

    ide.focusedWin = ide.wins['0']; // last focused window, it might not have the focus right now
    ide.switchWin = (x) => { // x: +1 or -1
      const a = [];
      let i = -1;
      const { wins } = D.ide;
      Object.keys(wins).forEach((k) => {
        wins[k].hasFocus() && (i = a.length);
        a.push(wins[k]);
      });
      const j = i < 0 ? 0 : (i + a.length + x) % a.length;
      const w = a[j];
      if (!w.bwId) D.elw.focus();
      w.focus(); return !1;
    };
  }
  // We need to be able to temporarily block the stream of messages coming from socket.io
  // Creating a floating window can only be done asynchronously and it's possible that a message
  // for it comes in before the window is ready.
  const mq = []; // mq:message queue
  let blk = 0; // blk:blocked?
  let tid = 0; // tid:timeout id
  let last = 0; // last:when last rundown finished
  function rd() { // run down the queue
    while (mq.length && !blk) {
      const a = mq.shift(); // a[0]:command name, a[1]:command args
      if (a[0] === 'AppendSessionOutput') { // special case: batch sequences of AppendSessionOutput together
        let s = a[1].result;
        const nq = Math.min(mq.length, 256);
        if (typeof s === 'object') { s = s.join('\n'); ide.bannerDone = 0; }
        let i;
        for (i = 0; i < nq && mq[i][0] === 'AppendSessionOutput'; i++) {
          const r = mq[i][1].result;
          s += typeof r === 'string' ? r : r.join('\n');
        }
        i && mq.splice(0, i);
        ide.wins[0].add(s);
      } else {
        const f = ide.handlers[a[0]];
        f ? f.apply(ide, a.slice(1)) : D.send('UnknownCommand', { name: a[0] });
      }
    }
    last = +new Date(); tid = 0;
  }
  function rrd() { // request rundown
    tid || (new Date() - last < 20 ? (tid = setTimeout(rd, 20)) : rd());
  }
  D.recv = (x, y) => { mq.push([x, y]); rrd(); };
  ide.block = () => { blk += 1; };
  ide.unblock = () => { (blk -= 1) || rrd(); };
  ide.tracer = () => {
    const tc = Object.keys(ide.wins).find(k => !!ide.wins[k].tc);
    return tc && ide.wins[tc];
  };
  [{ comp_name: 'wse', prop_name: 'WSEwidth' }, { comp_name: 'dbg', prop_name: 'DBGwidth' }].forEach((obj) => {
    Object.defineProperty(ide, obj.prop_name, {
      get() {
        const comp = this.gl.root.getComponentsByName(obj.comp_name)[0];
        return comp && comp.container && comp.container.width;
      },
      set(w) {
        const comp = this.gl.root.getComponentsByName(obj.comp_name)[0];
        comp && comp.container && comp.container.setSize(w);
      },
    });
  });

  // language bar
  let ttid; // tooltip timeout id
  let lbDragged;
  const reqTip = (x, desc, text, delay) => { // request tooltip, x:event
    clearTimeout(ttid);
    const t = x.target;
    ttid = setTimeout(() => {
      ttid = 0;
      I.lb_tip_desc.textContent = desc;
      I.lb_tip_text.textContent = text;
      I.lb_tip.hidden = 0; I.lb_tip_tri.hidden = 0;
      let s = I.lb_tip_tri.style;
      s.left = `${(t.offsetLeft + ((t.offsetWidth - I.lb_tip_tri.offsetWidth) / 2))}px`;
      s.top = `${(t.offsetTop + t.offsetHeight)}px`;
      s = I.lb_tip.style;
      const x0 = t.offsetLeft - 21;
      const x1 = x0 + I.lb_tip.offsetWidth;
      const y0 = (t.offsetTop + t.offsetHeight) - 3;
      s.top = `${y0}px`;
      if (x1 > document.body.offsetWidth) {
        s.left = ''; s.right = '0';
      } else {
        s.left = `${Math.max(0, x0)}px`;
        s.right = '';
      }
    }, delay || 20);
  };
  I.lb.onclick = (x) => {
    const s = x.target.textContent;
    if (lbDragged || x.target.nodeName !== 'B' || /\s/.test(s)) return !1;
    const w = ide.focusedWin;
    w.hasFocus() ? w.insert(s) : D.util.insert(document.activeElement, s);
    return !1;
  };
  I.lb.onmouseout = (x) => {
    if (x.target.nodeName === 'B' || x.target.id === 'lb_prf') {
      clearTimeout(ttid); ttid = 0; I.lb_tip.hidden = 1; I.lb_tip_tri.hidden = 1;
    }
  };
  I.lb.onmouseover = (x) => {
    if (lbDragged || x.target.nodeName !== 'B') return;
    const c = x.target.textContent;
    const k = D.getBQKeyFor(c);
    const s = k && c.charCodeAt(0) > 127 ? `Keyboard: ${D.prf.prefixKey()}${k}\n\n` : '';
    if (/\S/.test(c)) { const h = D.lb.tips[c] || [c, '']; reqTip(x, h[0], s + h[1]); }
  };
  I.lb_prf.onmouseover = (x) => {
    const h = D.prf.keys();
    let s = '';
    const r = /^(BK|BT|ED|EP|FD|QT|RP|SC|TB|TC|TL)$/;
    for (let i = 0; i < D.cmds.length; i++) {
      const cmd = D.cmds[i];
      const [c, d, df] = cmd; // c:code, d:description, df:defaults
      r.test(c) && (s += `${c}: ${d}:${' '.repeat(Math.max(1, 25 - d.length))}${((h[c] || df).slice(-1)[0] || 'none')}\n`);
    }
    reqTip(x, 'Keyboard Shortcuts', `${s}...`, 1000);
  };
  I.lb_prf.onmousedown = () => { D.prf_ui(); return !1; };
  I.lb_prf.onclick = () => !1; // prevent # from appearing in the URL bar
  $(I.lb_inner).sortable({
    forcePlaceholderSize: 1,
    placeholder: 'lb_placeholder',
    revert: 1,
    distance: 8,
    start() { lbDragged = 1; },
    stop() { D.prf.lbarOrder(I.lb_inner.textContent); lbDragged = 0; },
  });
  D.prf.lbarOrder(this.lbarRecreate);

  const eachWin = (f) => { Object.keys(ide.wins).forEach((k) => { f(ide.wins[k]); }); };
  const gl = new GoldenLayout({
    settings: { showPopoutIcon: 0 },
    dimensions: { borderWidth: 4 },
    labels: { minimise: 'unmaximise' },
    content: [ide.floating ? { type: 'stack' } : {
      title: 'Session',
      type: 'component',
      componentName: 'win',
      componentState: { id: 0 },
    }],
  }, $(ide.dom));
  ide.gl = gl;
  function Win(c, h) {
    const w = ide.wins[h.id];
    w.container = c;
    c.getElement().append(w.dom);
    c.on('tab', (tab) => {
      tab.element.click(() => {
        w.me && w.me.focus();
        w.focus();
      });
    });
    c.on('open', () => {
      $(c.getElement()).closest('.lm_item').find('.lm_maximise').onFirst('click', () => {
        w.saveScrollPos();
      });
    });
    w.me_ready.then(() => {
      if (ide.ipc) {
        // w.focus();
        ide.ipc.emit('mounted', h.id);
      } else {
        ide.hadErr > 0 && (ide.hadErr -= 1);
        ide.focusWin(w);
      }
    });
    return w;
  }
  function WSE(c) {
    const u = new D.WSE();
    ide.wse = u;
    u.container = c;
    c.getElement().append(u.dom);
    ide.DBGwidth = ide.dbgw;
    return u;
  }
  function DBG(c) {
    const u = new D.DBG();
    ide.dbg = u;
    u.container = c;
    c.getElement().append(u.dom);
    ide.getSIS(); ide.getThreads();
    ide.WSEwidth = ide.wsew;
    return u;
  }
  gl.registerComponent('win', Win);
  gl.registerComponent('wse', WSE);
  gl.registerComponent('dbg', DBG);
  let sctid; // stateChanged timeout id
  gl.on('stateChanged', () => {
    clearTimeout(sctid);
    sctid = setTimeout(() => {
      eachWin((w) => { w.stateChanged(); });
    }, 50);
    ide.wsew = ide.WSEwidth;
    ide.dbgw = ide.DBGwidth;
  });
  gl.on('itemDestroyed', () => { ide.wins[0] && ide.wins[0].saveScrollPos(); });
  gl.on('tabCreated', (x) => {
    x.element.off('mousedown', x._onTabClickFn); // remove default binding
    x.element.on('mousedown', (e) => {
      if (e.button === 0 || e.type === 'touchstart') {
        x.header.parent.setActiveContentItem(x.contentItem);
      } else if (e.button === 1 && x.contentItem.config.isClosable) {
        if (x.middleClick) x.middleClick();
        else x._onTabClick(e);
      }
    });
    const cls = x.closeElement;
    switch (x.contentItem.componentName) {
      case 'dbg':
        x.middleClick = D.prf.dbg.toggle;
        cls.off('click').click(D.prf.dbg.toggle);
        break;
      case 'wse':
        x.middleClick = D.prf.wse.toggle;
        cls.off('click').click(D.prf.wse.toggle);
        break;
      case 'win': {
        const { id } = x.contentItem.config.componentState;
        if (id) {
          const ep = () => { const w = ide.wins[id]; w.EP(w.me); };
          x.middleClick = ep;
          cls.off('click').click(ep);
        } else {
          cls.remove();
          x.titleElement[0].closest('.lm_tab').style.paddingRight = '10px';
        }
      }
        break;
      default:
    }
  });
  gl.init();

  const updTopBtm = () => {
    ide.dom.style.top = `${(D.prf.lbar() ? I.lb.offsetHeight : 0) + (D.el ? 0 : 22)}px`;
    gl.updateSize(ide.dom.clientWidth, ide.dom.clientHeight);
  };
  I.lb.hidden = !D.prf.lbar();
  updTopBtm();
  $(window).resize(updTopBtm);
  D.prf.lbar((x) => { I.lb.hidden = !x; updTopBtm(); });
  setTimeout(() => {
    try {
      D.installMenu(D.parseMenuDSL(D.prf.menu()));
    } catch (e) {
      $.err('Invalid menu configuration -- the default menu will be used instead');
      console.error(e);
      D.installMenu(D.parseMenuDSL(D.prf.menu.getDefault()));
    }
  }, 100);
  D.prf.autoCloseBrackets((x) => { eachWin((w) => { w.autoCloseBrackets(!!x); }); });
  D.prf.ilf((x) => {
    const i = x ? -1 : D.prf.indent();
    eachWin((w) => { w.id && w.indent(i); });
  });
  D.prf.indent((x) => {
    const i = D.prf.ilf() ? -1 : x;
    eachWin((w) => { w.id && w.indent(i); });
  });
  D.prf.fold((x) => { eachWin((w) => { w.id && w.fold(!!x); }); });
  D.prf.matchBrackets((x) => { eachWin((w) => { w.matchBrackets(!!x); }); });
  const togglePanel = (compName, compTitle, left) => {
    if (!D.prf[compName]()) {
      gl.root.getComponentsByName(compName).forEach((x) => { x.container.close(); });
      return;
    }
    // var si=D.ide.wins[0].cm.getScrollInfo() //remember session scroll position
    let p = gl.root.contentItems[0];
    if (p.type !== 'row') {
      const row = gl.createContentItem({ type: 'row' }, p);
      p.parent.replaceChild(p, row);
      row.addChild(p, 0, true); row.callDownwards('setSize');
      p = row;
    }
    p.addChild({
      type: 'component',
      componentName: compName,
      title: compTitle,
      fixedSize: true,
    }, left ? 0 : p.contentItems.length);
    // // D.ide.wins[0].me.scrollTo(si.left,si.top)
    const w = left ? 200 : 300;
    D.ide[`${compName.toUpperCase()}width`] = w;
    D.ide[`${compName}w`] = w;
  };
  const toggleWSE = () => { togglePanel('wse', 'Workspace Explorer', 1); };
  const toggleDBG = () => { togglePanel('dbg', 'Debug', 0); };
  D.prf.wse(toggleWSE); D.prf.wse() && setTimeout(toggleWSE, 500);
  D.prf.dbg(toggleDBG); D.prf.dbg() && setTimeout(toggleDBG, 500);
  // OSX is stealing our focus.  Let's steal it back!  Bug #5
  D.mac && !ide.floating && setTimeout(() => { ide.wins[0].focus(); }, 500);
  D.prf.lineNums((x) => { eachWin((w) => { w.id && w.setLN(x); }); });
  D.prf.breakPts((x) => { eachWin((w) => { w.id && w.setBP(x); }); });
  ide.handlers = { // for RIDE protocol messages
    Identify(x) {
      D.remoteIdentification = x;
      ide.updTitle();
      ide.connected = 1;
      ide.updPW(1);
      clearTimeout(D.tmr);
      delete D.tmr;
    },
    Disconnect(x) {
      const m = x.message.toLowerCase(); ide.die();
      if (m === 'dyalog session has ended') {
        ide.connected = 0; window.close();
      } else { $.err(x.message, 'Interpreter disconnected'); }
    },
    SysError(x) { $.err(x.text, 'SysError'); ide.die(); },
    InternalError(x) { $.err(`An error (${x.error}) occurred processing ${x.message}`, 'Internal Error'); },
    NotificationMessage(x) { $.alert(x.message, 'Notification'); },
    UpdateDisplayName(x) {
      ide.wsid = x.displayName; ide.updTitle(); ide.wse && ide.wse.refresh();
    },
    EchoInput(x) { ide.wins[0].add(x.input); },
    SetPromptType(x) {
      const t = x.type;
      if (t && ide.pending.length) D.send('Execute', { trace: 0, text: `${ide.pending.shift()}\n` });
      else eachWin((w) => { w.prompt(t); });
      t === 4 && ide.wins[0].focus(); // ⍞ input
      if (t === 1 && ide.bannerDone === 0) {
        // arrange for the banner to appear at the top of the session window
        ide.bannerDone = 1;
        const { me } = ide.wins[0];
        me.focus();
        const txt = me.getValue().split('\n');
        let i = txt.length;
        while (--i) { if (/^Dyalog APL/.test(txt[i])) break; }
        setTimeout(() => {
          me.revealRangeAtTop(new monaco.Range(i + 1, 1, i + 1, 1));
        }, 1);
      }
    },
    HadError() {
      ide.pending.splice(0, ide.pending.length);
      ide.wins[0].focus();
      ide.hadErr = 2 + D.prf.ilf(); // gl mounted + SetHilghlightLine + ReplyFormatCode
    },
    GotoWindow(x) { const w = ide.wins[x.win]; w && w.focus(); },
    WindowTypeChanged(x) { return ide.wins[x.win].setTC(x.tracer); },
    ReplyGetAutocomplete(x) { const w = ide.wins[x.token]; w && w.processAutocompleteReply(x); },
    ValueTip(x) { ide.wins[x.token].ValueTip(x); },
    SetHighlightLine(x) {
      const w = D.wins[x.win];
      w.SetHighlightLine(x.line, ide.hadErr);
      ide.hadErr > 0 && --ide.hadErr;
      ide.focusWin(w);
    },
    UpdateWindow(x) {
      const w = ide.wins[x.token];
      if (w) {
        w.container && w.container.setTitle(x.name);
        w.open(x);
      }
    },
    ReplySaveChanges(x) { const w = ide.wins[x.win]; w && w.saved(x.err); },
    CloseWindow(x) {
      const w = ide.wins[x.win];
      if (w.bwId) {
        w.close();
        w.id = -1;
      } else if (w) {
        w.container && w.container.close();
      }
      delete ide.wins[x.win]; ide.focusMRUWin();
      ide.WSEwidth = ide.wsew; ide.DBGwidth = ide.dbgw;
      if (w.tc) { ide.getSIS(); ide.getThreads(); }
    },
    OpenWindow(ee) {
      if (!ee.debugger && D.el && process.env.RIDE_EDITOR) {
        const fs = nodeRequire('fs');
        const os = nodeRequire('os');
        const cp = nodeRequire('child_process');
        const d = `${os.tmpDir()}/dyalog`;
        fs.existsSync(d) || fs.mkdirSync(d, 7 * 8 * 8); // rwx------
        const f = `${d}/${ee.name}.dyalog`;
        fs.writeFileSync(f, ee.text, { encoding: 'utf8', mode: 6 * 8 * 8 }); // rw-------
        const p = cp.spawn(
          process.env.RIDE_EDITOR,
          [f],
          { env: $.extend({}, process.env, { LINE: `${1 + (ee.currentRow || 0)}` }) },
        );
        p.on('error', (x) => { $.err(x); });
        p.on('exit', () => {
          const s = fs.readFileSync(f, 'utf8'); fs.unlinkSync(f);
          D.send('SaveChanges', {
            win: ee.token,
            text: s.split('\n'),
            stop: ee.stop,
            trace: ee.trace,
            monitor: ee.monitor,
          });
          D.send('CloseWindow', { win: ee.token });
        });
        return;
      }
      const w = ee.token;
      let done;
      const editorOpts = { id: w, name: ee.name, tc: ee.debugger };
      !editorOpts.tc && (ide.hadErr = -1);
      if (D.el && D.prf.floating() && !ide.dead) {
        ide.block(); // the popup will create D.wins[w] and unblock the message queue
        D.IPC_LinkEditor({ editorOpts, ee });
        done = 1;
      } else if (D.elw && !D.elw.isFocused()) D.elw.focus();
      if (done) return;
      // (ide.wins[w]=new D.Ed(ide,editorOpts)).open(ee)
      const ed = new D.Ed(ide, editorOpts);
      ide.wins[w] = ed;
      ed.me_ready.then(() => ed.open(ee));
      // add to golden layout:
      // const si = ide.wins[0].cm.getScrollInfo(); // remember session scroll position
      const tc = !!ee.debugger;
      const bro = gl.root.getComponentsByName('win').filter(x => x.id && tc === !!x.tc)[0]; // existing editor
      let p;
      if (bro) { // add next to existing editor
        p = bro.container.parent.parent;
      } else { // add to the right
        [p] = gl.root.contentItems;
        const t0 = tc ? 'column' : 'row';
        if (p.type !== t0) {
          const q = gl.createContentItem({ type: t0 }, p);
          p.parent.replaceChild(p, q);
          q.addChild(p); q.callDownwards('setSize'); p = q;
        }
      }
      const ind = p.contentItems.length - !(editorOpts.tc || !!bro || !D.prf.dbg());
      p.addChild({
        type: 'component',
        componentName: 'win',
        componentState: { id: w },
        title: ee.name,
      }, ind);
      ide.WSEwidth = ide.wsew; ide.DBGwidth = ide.dbgw;
      if (tc) {
        ide.getSIS();
        ide.wins[0].scrollCursorIntoView();
      }// else ide.wins[0].me.scrollTo(si.left, si.top);
    },
    ShowHTML(x) {
      if (D.el) {
        let w = ide.w3500;
        if (!w || w.isDestroyed()) {
          ide.w3500 = new D.el.BrowserWindow({ width: 800, height: 500 });
          w = ide.w3500;
        }
        w.loadURL(`file://${__dirname}/empty.html`);
        w.webContents.executeJavaScript(`document.body.innerHTML=${JSON.stringify(x.html)}`);
        w.setTitle(x.title || '3500 I-beam');
      } else {
        const init = () => {
          ide.w3500.document.body.innerHTML = x.html;
          ide.w3500.document.getElementsByTagName('title')[0].innerHTML = D.util.esc(x.title || '3500⌶');
        };
        if (ide.w3500 && !ide.w3500.closed) {
          ide.w3500.focus(); init();
        } else {
          ide.w3500 = window.open('empty.html', '3500 I-beam', 'width=800,height=500');
          ide.w3500.onload = init;
        }
      }
    },
    OptionsDialog(x) {
      let text = typeof x.text === 'string' ? x.text : x.text.join('\n');
      if (D.el) { // && process.env.RIDE_NATIVE_DIALOGS) {
        const { bwId } = D.ide.focusedWin;
        const bw = bwId ? D.el.BrowserWindow.fromId(bwId) : D.elw;
        const r = D.el.dialog.showMessageBox(bw, {
          message: text,
          title: x.title || '',
          buttons: x.options || [''],
          cancelId: -1,
          type: ['warning', 'info', 'question', 'error'][x.type - 1],
        });
        D.send('ReplyOptionsDialog', { index: r, token: x.token });
      } else {
        text = text.replace(/\r?\n/g, '<br>');
        I.gd_title_text.textContent = x.title || '';
        I.gd_content.innerHTML = text;
        I.gd_icon.style.display = '';
        I.gd_icon.className = `dlg_icon_${['warn', 'info', 'query', 'error'][x.type - 1]}`;
        I.gd_btns.innerHTML = (x.options || []).map(y => `<button>${D.util.esc(y)}</button>`).join('');
        const b = I.gd_btns.querySelector('button');
        const ret = (r) => {
          I.gd_btns.onclick = null;
          I.gd_close.onclick = null;
          I.gd.hidden = 1;
          D.send('ReplyOptionsDialog', { index: r, token: x.token });
          D.ide.focusedWin.focus();
        };
        I.gd_close.onclick = () => ret(-1);
        I.gd_btns.onclick = (e) => {
          if (e.target.nodeName === 'BUTTON') {
            let i = -1;
            let t = e.target;
            while (t) { t = t.previousSibling; i += 1; }
            ret(i);
          }
        };
        D.util.dlg(I.gd, { w: 400 });
        setTimeout(() => { b.focus(); }, 1);
      }
    },
    StringDialog(x) {
      I.gd_title_text.textContent = x.title || '';
      I.gd_content.innerText = x.text || '';
      I.gd_icon.style.display = 'none';
      I.gd_content.insertAdjacentHTML('beforeend', '<br><input>');
      const inp = I.gd_content.querySelector('input');
      inp.value = x.initialValue || '';
      I.gd_btns.innerHTML = '<button>OK</button><button>Cancel</button>';
      const ret = (r) => {
        I.gd_btns.onclick = null;
        I.gd_close.onclick = null;
        I.gd.hidden = 1;
        D.send('ReplyStringDialog', { value: r, token: x.token });
        D.ide.focusedWin.focus();
      };
      I.gd_close.onclick = () => { ret(x.defaultValue || null); };
      I.gd_btns.onclick = (e) => {
        if (e.target.nodeName === 'BUTTON') {
          ret(e.target.previousSibling ? x.defaultValue || null : inp.value);
        }
      };
      D.util.dlg(I.gd, { w: 400, h: 250 });
      setTimeout(() => { inp.focus(); }, 1);
    },
    TaskDialog(x) {
      const { esc } = D.util;
      I.gd_title_text.textContent = x.title || '';
      I.gd_icon.style.display = 'none';
      I.gd_content.innerHTML = esc(x.text || '') + (x.subtext ? `<div class=task_subtext>${esc(x.subtext)}</div>` : '');
      I.gd_btns.innerHTML =
        (x.buttonText || []).map(y => `<button class=task>${esc(y)}</button>`).join('') +
        (x.footer ? `<div class=task_footer>${esc(x.footer)}</div>` : '');
      const ret = (r) => {
        I.gd_btns.onclick = null;
        I.gd_close.onclick = null;
        I.gd.hidden = 1;
        D.send('ReplyTaskDialog', { index: r, token: x.token });
        D.ide.focusedWin.focus();
      };
      const b = I.gd_btns.querySelector('button');
      I.gd_close.onclick = () => { ret(-1); };
      I.gd_btns.onclick = (e) => {
        if (e.target.nodeName === 'BUTTON') {
          let t = e.target;
          let i = 99;
          while (t) { t = t.previousSibling; i += 1; }
          ret(i);
        }
      };
      D.util.dlg(I.gd, { w: 400, h: 300 });
      setTimeout(() => { b.focus(); }, 1);
    },
    ReplyGetSIStack(x) { ide.dbg && ide.dbg.sistack.render(x.stack); },
    ReplyGetThreads(x) { ide.dbg && ide.dbg.threads.render(x.threads); },
    ReplyFormatCode(x) {
      const w = D.wins[x.win];
      w.ReplyFormatCode(x.text);
      ide.hadErr > 0 && (ide.hadErr -= 1);
      ide.focusWin(w);
    },
    ReplyTreeList(x) { ide.wse.replyTreeList(x); },
    StatusOutput(x) {
      let w = ide.wStatus;
      if (!D.el) return;
      if (!w) {
        ide.wStatus = new D.el.BrowserWindow({ width: 600, height: 400, parent: D.elw });
        w = ide.wStatus;
        w.setTitle('Status Output');
        w.loadURL(`file://${__dirname}/status.html`);
        w.on('closed', () => { delete ide.wStatus; });
      }
      w.webContents.executeJavaScript(`add(${JSON.stringify(x)})`);
    },
    ReplyGetLog(x) { ide.wins[0].add(x.result.join('\n')); ide.bannerDone = 0; },
    UnknownCommand() { },
  };
};
D.IDE.prototype = {
  setConnInfo(x, y, z) {
    const ide = this;
    ide.host = x;
    ide.port = y;
    ide.profile = z;
    ide.updTitle();
  },
  die() { // don't really, just pretend
    const ide = this;
    if (ide.dead) return;
    ide.dead = 1;
    ide.connected = 0;
    ide.dom.className += ' disconnected';
    Object.keys(ide.wins).forEach((k) => { ide.wins[k].die(); });
  },
  getThreads: $.debounce(100, () => { D.prf.dbg() && D.send('GetThreads', {}); }),
  getSIS: $.debounce(100, () => {
    if (this.floating) this.ipc.emit('getSIS');
    else D.prf.dbg() && D.send('GetSIStack', {});
  }),
  updPW(x) { this.wins[0].updPW(x); },
  updTitle() { // change listener for D.prf.title
    const ide = this;
    const ri = D.remoteIdentification || {};
    const [ch, bits] = (ri.arch || '').split('/');
    const [va, vb, vc] = (ri.version || '').split('.');
    const v = D.versionInfo || {};
    const [rva, rvb, rvc] = (v.version || '').split('.');
    const m = {
      '{WSID}': ide.wsid,
      '{HOST}': ide.host,
      '{PORT}': ide.port,
      '{VER_A}': va,
      '{VER_B}': vb,
      '{VER_C}': vc,
      '{VER}': ri.version,
      '{PROFILE}': ide.profile,
      '{PID}': ri.pid,
      '{CHARS}': ch,
      '{BITS}': bits,
      '{RIDE_VER_A}': rva,
      '{RIDE_VER_B}': rvb,
      '{RIDE_VER_C}': rvc,
      '{RIDE_VER}': v.version,
    };
    document.title = D.prf.title().replace(/\{\w+\}/g, x => m[x.toUpperCase()] || x) || 'Dyalog';
  },
  focusWin(w) {
    if (this.hadErr === 0) {
      D.elw && D.elw.focus();
      this.wins[0].focus();
      this.wins[0].hadErr = +new Date();
      this.hadErr = -1;
    } else if (this.hadErr < 0) { w.focus(); }
  },
  focusMRUWin() { // most recently used
    const { wins } = this;
    let t = 0;
    let w = wins[t];
    Object.keys(wins).forEach((k) => {
      const x = wins[k];
      if (x.id && t <= x.focusTS) { w = x; t = x.focusTS; }
    });
    if (!w.bwId) D.elw.focus();
    w.focus();
  },
  zoom(z) {
    const { wins } = this;
    Object.keys(wins).forEach((x) => { wins[x].zoom(z); });
    wins[0] && wins[0].restoreScrollPos();
    this.gl.container.resize();
  },
  LBR: D.prf.lbar.toggle,
  FLT: D.prf.floating.toggle,
  WRP: D.prf.wrap.toggle,
  TOP: D.prf.floatOnTop.toggle,
  TVB: D.prf.breakPts.toggle,
  LN: D.prf.lineNums.toggle,
  TVO: D.prf.fold.toggle,
  UND() { this.focusedWin.me.trigger('D', 'undo'); },
  RDO() { this.focusedWin.me.trigger('D', 'redo'); },
  CAW() { D.send('CloseAllWindows', {}); },
  Edit(data) {
    if (this.floating) { this.ipc.emit('Edit', data); return; }
    D.pendingEdit = D.pendingEdit || data;
    D.pendingEdit.unsaved = D.pendingEdit.unsaved || {};
    const u = D.pendingEdit.unsaved;
    let v;
    let w;
    let bws = 0;
    Object.keys(this.wins).forEach((k) => {
      w = this.wins[k];
      v = +k && (w.getUnsaved ? w.getUnsaved() : -1);
      if (v) u[k] = v;
      bws = bws || v === -1;
    });
    if (bws && D.ipc.server) {
      D.ipc.server.broadcast('getUnsaved');
    } else {
      D.send('Edit', D.pendingEdit);
      delete D.pendingEdit;
    }
  },
  getUnsaved() {
    const r = {};
    Object.keys(this.wins).forEach((k) => {
      const v = (+k && this.wins[k].getUnsaved());
      if (v) r[k] = v;
    });
    return r;
  },
  _disconnected() { this.die(); }, // invoked from cn.js
  lbarRecreate() {
    const d = D.lb.order; // d:default order
    const u = D.prf.lbarOrder(); // u:user's order
    let r = '';
    if (d !== u) {
      for (let i = 0; i < d.length; i++) {
        if (!u.includes(d[i]) && /\S/.test(d[i])) r += d[i]; // r:set difference between d and u
      }
    }
    I.lb_inner.innerHTML = D.prf.lbarOrder()
      .replace(/\s*$/, `\xa0${r}${r && '\xa0'}`) // replace any trailing spaces with missing glyphs and final nbs
      .replace(/\s+/g, '\xa0').replace(/(.)/g, '<b>$1</b>'); // replace white spaces with single nbs and markup
  },
  onbeforeunload(e) { // called when the user presses [X] on the OS window
    const ide = this;
    if (ide.floating && ide.connected) { e.returnValue = false; }
    if (ide.dead) {
      D.nww && D.nww.close(true); // force close window
    } else {
      Object.keys(ide.wins).forEach((k) => {
        const ed = ide.wins[k];
        const { me } = ed;
        if (ed.tc || (me.getValue() === ed.oText && `${ed.getStops()}` === `${ed.oStop}`)) {
          ed.EP(me);
        } else {
          setTimeout(() => {
            window.focus();
            const r = D.el.dialog.showMessageBox(D.el.getCurrentWindow(), {
              title: 'Save?',
              buttons: ['Yes', 'No', 'Cancel'],
              cancelId: -1,
              message: `The object "${ed.name}" has changed.\nDo you want to save the changes?`,
            });
            if (r === 0) ed.EP(me);
            else if (r === 1) ed.QT(me);
            return '';
          }, 10);
        }
      });
    }
  },
};

