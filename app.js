/* 车辆加油账本 —— 前端逻辑（数据保存在本机浏览器） */
(function () {
  'use strict';

  var STORE_KEY = 'carFuelLog.v1';
  var SEED = (window.SEED_RECORDS || []).map(function (r, i) {
    return {
      id: 'seed-' + (i + 1),
      date: r.date,
      km: Number(r.km) || 0,
      liters: Number(r.liters) || 0,
      cost: Number(r.cost) || 0,
      note: r.note || ''
    };
  });

  var records = [];
  var meta = { firstUseAt: null, lastExportAt: null };
  var editingId = null;
  var lastDeleted = null;
  var toastTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 工具 ---------------- */

  function round(v, d) {
    var p = Math.pow(10, d);
    return Math.round(v * p) / p;
  }

  function num(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/[，,\s]/g, '.').replace(/[^\d.\-]/g, '');
    if (s === '' || s === '.' || s === '-') return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toLocaleString('zh-CN', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '¥—';
    return '¥' + fmt(v, 2);
  }

  function todayISO() {
    var d = new Date();
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function fmtDate(iso) {
    var p = dateParts(iso);
    return p ? p.y + '年' + p.m + '月' + p.d + '日' : String(iso || '');
  }

  function shortDate(iso) {
    var p = dateParts(iso);
    return p ? p.m + '/' + p.d : '';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function consumption(r) {
    if (!(r.km > 0) || !(r.liters > 0)) return null;
    return (r.liters / r.km) * 100;
  }

  function unitPrice(r) {
    if (!(r.liters > 0) || !(r.cost > 0)) return null;
    return r.cost / r.liters;
  }

  function sortAsc(list) {
    return list.slice().sort(function (a, b) {
      if (a.date === b.date) return String(a.id) < String(b.id) ? -1 : 1;
      return a.date < b.date ? -1 : 1;
    });
  }

  /* ---------------- 存储 ---------------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.records)) {
          meta = data.meta || meta;
          return data.records.map(function (r) {
            return {
              id: String(r.id || ('r' + Math.random().toString(36).slice(2))),
              date: r.date,
              km: Number(r.km) || 0,
              liters: Number(r.liters) || 0,
              cost: Number(r.cost) || 0,
              note: r.note || ''
            };
          });
        }
      }
    } catch (e) { /* 存储不可用时退回初始数据 */ }
    return SEED.slice();
  }

  function save() {
    if (!meta.firstUseAt) meta.firstUseAt = new Date().toISOString();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        meta: meta,
        records: records
      }));
      return true;
    } catch (e) {
      toast('保存失败：浏览器不允许存储，请先导出备份');
      return false;
    }
  }

  /* ---------------- 渲染 ---------------- */

  function totals() {
    var t = { km: 0, liters: 0, cost: 0, count: records.length };
    records.forEach(function (r) {
      t.km += r.km || 0;
      t.liters += r.liters || 0;
      t.cost += r.cost || 0;
    });
    t.avgCons = t.km > 0 && t.liters > 0 ? (t.liters / t.km) * 100 : null;
    t.avgPrice = t.liters > 0 && t.cost > 0 ? t.cost / t.liters : null;
    t.perKm = t.km > 0 && t.cost > 0 ? t.cost / t.km : null;
    return t;
  }

  function render() {
    records = sortAsc(records);
    var t = totals();
    var asc = records.slice();

    $('heroCount').textContent = t.count;
    $('heroKm').textContent = fmt(Math.round(t.km), 0);
    $('heroAvg').textContent = t.avgCons === null ? '—' : fmt(t.avgCons, 2);

    $('sumCost').textContent = money(t.cost);
    $('sumLiters').innerHTML = fmt(t.liters, 2) + '<span class="sum-unit">升</span>';
    $('sumPrice').innerHTML = (t.avgPrice === null ? '—' : fmt(t.avgPrice, 2)) + '<span class="sum-unit">元/升</span>';
    $('sumPerKm').innerHTML = (t.perKm === null ? '—' : fmt(t.perKm, 2)) + '<span class="sum-unit">元</span>';

    var latest = asc[asc.length - 1];
    $('latestText').textContent = latest ? '最近一次 ' + fmtDate(latest.date) : '';

    renderChart(asc);
    renderList(asc);
    updateBackupHint();
  }

  function renderChart(asc) {
    var valid = asc.filter(function (r) { return consumption(r) !== null; }).slice(-8);
    var card = $('chartCard');
    var chart = $('chart');
    if (valid.length < 3) {
      card.hidden = true;
      chart.innerHTML = '';
      return;
    }
    card.hidden = false;

    var values = valid.map(consumption);
    var max = Math.max.apply(null, values);

    chart.innerHTML = valid.map(function (r, i) {
      var v = values[i];
      var h = Math.round(30 + (v / max) * 92);
      return '' +
        '<div class="bar-col">' +
          '<span class="bar-val">' + fmt(v, 1) + '</span>' +
          '<div class="bar" style="height:' + h + 'px"></div>' +
          '<span class="bar-date">' + shortDate(r.date) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderList(asc) {
    var list = $('recordList');
    var empty = $('emptyState');
    if (!asc.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    var seqOf = {};
    asc.forEach(function (r, i) { seqOf[r.id] = i + 1; });

    var latestId = asc[asc.length - 1].id;

    list.innerHTML = asc.slice().reverse().map(function (r) {
      var c = consumption(r);
      var p = unitPrice(r);
      return '' +
        '<li class="record' + (r.id === latestId ? ' record--latest' : '') + '">' +
          '<div class="rec-top">' +
            '<span class="rec-date">' + esc(fmtDate(r.date)) + '</span>' +
            '<span class="rec-seq">第' + seqOf[r.id] + '次</span>' +
            '<button class="rec-edit" type="button" data-edit="' + esc(r.id) + '">修改</button>' +
          '</div>' +
          '<div class="rec-main">' +
            '<div class="rec-cons"><b>' + (c === null ? '—' : fmt(c, 2)) + '</b>' +
              (c === null ? '' : '<span>升/百公里</span>') + '</div>' +
            '<div class="rec-cost">' + money(r.cost) + '</div>' +
          '</div>' +
          '<dl class="rec-facts">' +
            '<div><dt>本次里程</dt><dd>' + fmt(r.km, 0) + ' 公里</dd></div>' +
            '<div><dt>加油量</dt><dd>' + fmt(r.liters, 2) + ' 升</dd></div>' +
            '<div><dt>每升油价</dt><dd>' + (p === null ? '—' : fmt(p, 2) + ' 元') + '</dd></div>' +
          '</dl>' +
          (r.note ? '<div class="rec-note">' + esc(r.note) + '</div>' : '') +
        '</li>';
    }).join('');
  }

  function updateBackupHint() {
    var hint = $('backupHint');
    var last = meta.lastExportAt ? new Date(meta.lastExportAt) : null;
    var first = meta.firstUseAt ? new Date(meta.firstUseAt) : null;
    var old = first ? (Date.now() - first.getTime()) > 7 * 864e5 : false;
    var stale = last ? (Date.now() - last.getTime()) > 30 * 864e5 : old;
    hint.hidden = !(records.length > 0 && stale);
    $('backupTime').textContent = last
      ? '上次导出：' + fmtDate(last.toISOString().slice(0, 10))
      : '还没有导出过备份';
  }

  /* ---------------- 弹层 ---------------- */

  function openSheet(el) {
    el.hidden = false;
    document.body.classList.add('locked');
  }

  function closeSheet(el) {
    el.hidden = true;
    if ($('sheet').hidden && $('helpSheet').hidden) {
      document.body.classList.remove('locked');
    }
  }

  function closeAll() {
    closeSheet($('sheet'));
    closeSheet($('helpSheet'));
  }

  /* ---------------- 表单 ---------------- */

  function fillForm(r) {
    $('fDate').value = r ? r.date : todayISO();
    $('fKm').value = r ? (r.km || '') : '';
    $('fLiters').value = r ? (r.liters || '') : '';
    $('fCost').value = r ? (r.cost || '') : '';
    $('fPrice').value = r ? (unitPrice(r) === null ? '' : round(unitPrice(r), 2)) : '';
    $('formError').hidden = true;
    $('deleteBtn').hidden = !r;
    $('sheetTitle').textContent = r ? '修改这一笔' : '记一笔加油';
    $('saveBtn').textContent = r ? '保存修改' : '保存';
    updatePreview();
  }

  function openForm(id) {
    editingId = id || null;
    var r = id ? records.filter(function (x) { return x.id === id; })[0] : null;
    fillForm(r || null);
    $('sheet').querySelector('.sheet-body').scrollTop = 0;
    openSheet($('sheet'));
  }

  function updatePreview() {
    var km = num($('fKm').value);
    var liters = num($('fLiters').value);
    var cost = num($('fCost').value);
    var price = num($('fPrice').value);

    var c = km > 0 && liters > 0 ? (liters / km) * 100 : null;
    $('previewValue').textContent = c === null ? '—' : fmt(c, 2);

    var sub = '填好里程和油量，这里自动出现油耗';
    if (c !== null) {
      sub = '本趟跑了 ' + fmt(km, 0) + ' 公里，用了 ' + fmt(liters, 2) + ' 升';
      if (cost === null && price !== null && liters > 0) {
        sub += '，按油价算约 ' + money(price * liters);
      } else if (cost !== null && liters > 0) {
        sub += '，每升约 ' + fmt(cost / liters, 2) + ' 元';
      }
    }
    $('previewSub').textContent = sub;
  }

  function showError(msg) {
    var el = $('formError');
    el.textContent = msg;
    el.hidden = false;
  }

  function onSubmit(e) {
    e.preventDefault();
    var date = $('fDate').value;
    var km = num($('fKm').value);
    var liters = num($('fLiters').value);
    var cost = num($('fCost').value);
    var price = num($('fPrice').value);

    if (!dateParts(date)) return showError('请选择加油日期');
    if (km === null || km <= 0) return showError('请填本次行驶里程，要大于 0 公里');
    if (liters === null || liters < 0) return showError('请填加油量（升）');
    if (liters === 0 && cost > 0) return showError('油量是 0，费用也应该是 0');
    if (liters > 0 && cost === null && price === null) {
      return showError('请填加油费用或每升油价，填一个就行');
    }
    if (cost !== null && cost < 0) return showError('费用不能是负数');
    if (price !== null && price < 0) return showError('油价不能是负数');

    if (cost === null && price !== null) cost = price * liters;
    if (cost === null) cost = 0;
    cost = round(cost, 2);

    var existing = editingId ? records.filter(function (x) { return x.id === editingId; })[0] : null;
    var rec = {
      id: existing ? existing.id : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: date,
      km: round(km, 2),
      liters: round(liters, 3),
      cost: cost,
      note: existing ? existing.note : ''
    };

    if (existing) {
      records = records.map(function (x) { return x.id === rec.id ? rec : x; });
    } else {
      records.push(rec);
    }
    save();
    render();
    closeAll();
    toast(existing ? '已保存修改' : '已记录：' + fmtDate(rec.date) + '，油耗 ' +
      (consumption(rec) === null ? '—' : fmt(consumption(rec), 2) + ' 升/百公里'));
  }

  function openEdit(id) {
    openForm(id);
  }

  function deleteCurrent() {
    if (!editingId) return;
    var idx = records.findIndex(function (x) { return x.id === editingId; });
    if (idx < 0) return;
    lastDeleted = { rec: records[idx], index: idx };
    records.splice(idx, 1);
    save();
    render();
    closeAll();
    toast('已删除这一条', '撤销', function () {
      if (!lastDeleted) return;
      records.splice(Math.min(lastDeleted.index, records.length), 0, lastDeleted.rec);
      lastDeleted = null;
      save();
      render();
      toast('已恢复');
    });
  }

  /* ---------------- 备份 ---------------- */

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function exportJSON() {
    var payload = {
      app: '车辆加油账本',
      version: 1,
      exportedAt: new Date().toISOString(),
      note: window.CAR_NOTE || '',
      records: sortAsc(records)
    };
    download('加油记录备份-' + todayISO() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    meta.lastExportAt = new Date().toISOString();
    save();
    updateBackupHint();
    toast('备份已导出，请保存到「文件」或发给家人');
  }

  function exportCSV() {
    var asc = sortAsc(records);
    var t = totals();
    var rows = [['序号', '时间', '里程', '油量', '油耗', '单价', '费用合计']];
    asc.forEach(function (r, i) {
      var c = consumption(r);
      var p = unitPrice(r);
      rows.push([
        i + 1,
        r.date,
        r.km,
        r.liters,
        c === null ? '' : round(c, 2),
        p === null ? '' : round(p, 2),
        round(r.cost, 2)
      ]);
    });
    rows.push(['合计', '', round(t.km, 0), round(t.liters, 2),
      t.avgCons === null ? '' : round(t.avgCons, 2),
      t.avgPrice === null ? '' : round(t.avgPrice, 2), round(t.cost, 2)]);

    var csv = rows.map(function (row) {
      return row.map(function (v) {
        var s = String(v === null || v === undefined ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');

    download('加油记录表格-' + todayISO() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('表格已导出，电脑上可用 Excel 打开');
  }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var list = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(list) || !list.length) throw new Error('empty');
        var cleaned = list.map(function (r, i) {
          if (!dateParts(r.date)) throw new Error('bad date');
          return {
            id: String(r.id || ('imp' + i + '-' + Math.random().toString(36).slice(2))),
            date: r.date,
            km: Number(r.km) || 0,
            liters: Number(r.liters) || 0,
            cost: Number(r.cost) || 0,
            note: r.note || ''
          };
        });
        if (!confirm('备份里有 ' + cleaned.length + ' 条记录，将替换现在的 ' + records.length + ' 条。继续吗？')) return;
        records = cleaned;
        save();
        render();
        closeAll();
        toast('已恢复 ' + cleaned.length + ' 条记录');
      } catch (err) {
        alert('这个文件读不出来，请选择本网页导出的 .json 备份。');
      }
    };
    reader.readAsText(file);
  }

  function resetToSeed() {
    if (!confirm('这会清空现在所有记录，换回 Excel 里的 26 条原始数据。确定吗？')) return;
    if (!confirm('再确认一次：当前数据不能恢复（除非你导出过备份）。')) return;
    records = SEED.slice();
    meta = { firstUseAt: new Date().toISOString(), lastExportAt: null };
    save();
    render();
    closeAll();
    toast('已还原成 Excel 原始记录');
  }

  /* ---------------- 提示条 ---------------- */

  function toast(msg, actionLabel, action) {
    var el = $('toast');
    el.innerHTML = '<span></span><button type="button" hidden></button>';
    el.querySelector('span').textContent = msg;
    var btn = el.querySelector('button');
    if (actionLabel && action) {
      btn.textContent = actionLabel;
      btn.hidden = false;
      btn.onclick = function () {
        el.hidden = true;
        action();
      };
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, actionLabel ? 6500 : 4200);
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    $('addBtn').addEventListener('click', function () { openForm(null); });

    $('recordList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-edit]');
      if (btn) openEdit(btn.getAttribute('data-edit'));
    });

    $('form').addEventListener('submit', onSubmit);
    $('deleteBtn').addEventListener('click', deleteCurrent);

    ['fKm', 'fLiters', 'fCost', 'fPrice'].forEach(function (id) {
      $(id).addEventListener('input', updatePreview);
    });

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', closeAll);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });

    $('helpBtn').addEventListener('click', function () {
      openSheet($('helpSheet'));
    });

    $('exportBtn').addEventListener('click', exportJSON);
    $('exportCsvBtn').addEventListener('click', exportCSV);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = '';
    });
    $('resetBtn').addEventListener('click', resetToSeed);
  }

  /* ---------------- 启动 ---------------- */

  records = load();
  bind();
  render();
  if (!meta.firstUseAt) {
    meta.firstUseAt = new Date().toISOString();
    save();
  }

  if (window.CAR_NOTE) {
    $('carNote').textContent = '车辆备注：' + window.CAR_NOTE;
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
