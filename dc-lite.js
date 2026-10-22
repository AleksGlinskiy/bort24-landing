/* dc-lite: a tiny standalone renderer for the landing's x-dc template.
   Renders {{holes}}, <sc-if>, <sc-for>, ref and on* handlers, and re-renders by
   patching only what the template changed, so runtime classes/styles, focus and
   canvases survive state updates. */
(function () {
  'use strict';
  var EV = { onclick: 'click', onchange: 'input', onblur: 'focusout', onkeydown: 'keydown', onfocus: 'focusin', oninput: 'input' };
  function boot() {
    var xdc = document.querySelector('x-dc'); if (!xdc) return;
    var helmet = xdc.querySelector('helmet');
    if (helmet) { document.head.insertAdjacentHTML('beforeend', helmet.innerHTML); helmet.parentNode.removeChild(helmet); }
    var tpl = document.createElement('template'); tpl.innerHTML = xdc.innerHTML; xdc.parentNode.removeChild(xdc);
    var code = document.querySelector('script[data-dc-script]').textContent;
    var queued = false;
    function DCLogic(p) { this.props = p || {}; this.state = {}; }
    DCLogic.prototype.setState = function (o) {
      if (typeof o === 'function') o = o(this.state, this.props);
      if (o) for (var k in o) this.state[k] = o[k];
      schedule();
    };
    DCLogic.prototype.forceUpdate = function () { schedule(); };
    var C = new Function('DCLogic', code + '\n;return Component;')(DCLogic);
    var inst = new C({}); if (!inst.state) inst.state = {};
    var vals = {}, pendingRefs = [];
    function get(expr, scope) {
      expr = expr.trim();
      if (expr === 'true') return true; if (expr === 'false') return false;
      if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
      var parts = expr.split('.'), v = (scope && scope[parts[0]] !== undefined) ? scope[parts[0]] : vals[parts[0]];
      for (var i = 1; i < parts.length; i++) { if (v == null) return v; v = v[parts[i]]; }
      return v;
    }
    function interp(s, scope) {
      var m = s.match(/^\s*\{\{([^}]*)\}\}\s*$/); if (m) return get(m[1], scope);
      return s.replace(/\{\{([^}]*)\}\}/g, function (_, e) { var v = get(e, scope); return v == null ? '' : String(v); });
    }
    function build(node, scope, out, svg) {
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType === 3) { var t = document.createTextNode(interp(n.textContent, scope)); t.__t = t.nodeValue; out.appendChild(t); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName.toLowerCase();
        if (tag === 'sc-for') {
          var list = get(n.getAttribute('list').replace(/[{}]/g, ''), scope) || [], as = n.getAttribute('as');
          for (var j = 0; j < list.length; j++) { var sc = Object.create(scope || null); for (var k in scope) sc[k] = scope[k]; sc[as] = list[j]; sc.$index = j; build(n, sc, out, svg); }
          continue;
        }
        if (tag === 'sc-if') { if (get(n.getAttribute('value').replace(/[{}]/g, ''), scope)) build(n, scope, out, svg); continue; }
        var isSvg = svg || tag === 'svg';
        var el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', n.tagName) : document.createElement(tag);
        el.__attrs = {}; el.__h = {};
        for (var a = 0; a < n.attributes.length; a++) {
          var at = n.attributes[a], name = at.name;
          if (name.indexOf('hint-') === 0) continue;
          if (name === 'ref') { var rf = interp(at.value, scope); if (typeof rf === 'function') pendingRefs.push([rf, el]); continue; }
          if (EV[name]) { var fn = interp(at.value, scope); if (typeof fn === 'function') el.__h[EV[name]] = fn; continue; }
          var v = interp(at.value, scope);
          if (v === false || v == null || typeof v === 'function') continue;
          v = v === true ? '' : String(v);
          el.setAttribute(name, v); el.__attrs[name] = v;
        }
        build(n.content || n, scope, el, isSvg);
        out.appendChild(el);
      }
    }
    function syncAttrs(o, n) {
      var prev = o.__attrs || {}, next = n.__attrs || {}, k;
      for (k in next) if (prev[k] !== next[k]) {
        if (k === 'class' && prev[k] != null) {   // keep classes added at runtime
          var extra = (o.getAttribute('class') || '').split(/\s+/).filter(function (c) { return c && (' ' + prev[k] + ' ').indexOf(' ' + c + ' ') < 0; });
          o.setAttribute('class', (next[k] + ' ' + extra.join(' ')).trim());
        } else o.setAttribute(k, next[k]);
        if (k === 'value' && 'value' in o && document.activeElement !== o) o.value = next[k];
      }
      for (k in prev) if (!(k in next)) { o.removeAttribute(k); if (k === 'value' && 'value' in o && document.activeElement !== o) o.value = ''; }
      if ('disabled' in o) o.disabled = 'disabled' in next;
      o.__attrs = next; o.__h = n.__h;
    }
    function morph(oldP, newP) {
      var nc = Array.prototype.slice.call(newP.childNodes), oc = oldP.childNodes;
      for (var i = 0; i < nc.length; i++) {
        var o = oc[i], n = nc[i];
        if (!o) { oldP.appendChild(n); continue; }
        if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { oldP.replaceChild(n, o); continue; }
        if (o.nodeType === 3) { if (o.__t !== n.__t) { o.nodeValue = n.nodeValue; o.__t = n.__t; } continue; }
        syncAttrs(o, n);
        if (o.tagName !== 'CANVAS') morph(o, n);
      }
      while (oc.length > nc.length) oldP.removeChild(oc[oc.length - 1]);
    }
    var root = document.createElement('div'); root.id = '__root'; document.body.appendChild(root);
    Object.keys(EV).forEach(function (k) {
      var type = EV[k];
      if (root['__ev_' + type]) return; root['__ev_' + type] = 1;
      root.addEventListener(type, function (e) {
        for (var n = e.target; n && n !== root; n = n.parentNode) if (n.__h && n.__h[type]) { n.__h[type](e); return; }
      });
    });
    function render(first) {
      vals = inst.renderVals() || {}; pendingRefs = [];
      var frag = document.createElement('div'); build(tpl.content, {}, frag, false);
      if (first) { while (frag.firstChild) root.appendChild(frag.firstChild); }
      else morph(root, frag);
      var refs = pendingRefs.slice();
      if (first) refs.forEach(function (r) { try { r[0](r[1]); } catch (e) {} });
      root.querySelectorAll('select[value]').forEach(function (x) { x.value = x.getAttribute('value'); });
    }
    function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; render(false); }); }
    render(true);
    setTimeout(function () { if (inst.componentDidMount) try { inst.componentDidMount(); } catch (e) { console.error(e); } }, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
