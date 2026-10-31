/* 生成真正的 Excel 文件（.xlsx），不依赖任何外部库，离线也能用 */
(function () {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function zip(files) {
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    var parts = [];
    var central = [];
    var offset = 0;

    files.forEach(function (file) {
      var name = utf8(file.name);
      var data = file.data;
      var crc = crc32(data);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);

      parts.push(new Uint8Array(local.buffer), name, data);

      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint16(30, 0, true);
      cen.setUint16(32, 0, true);
      cen.setUint16(34, 0, true);
      cen.setUint16(36, 0, true);
      cen.setUint32(38, 0, true);
      cen.setUint32(42, offset, true);

      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    });

    var centralSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function num(v) {
    return (v === null || v === undefined || !isFinite(v)) ? null : Number(v);
  }

  function strCell(ref, value, style) {
    return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + ' t="inlineStr"><is><t>' +
      esc(value) + '</t></is></c>';
  }

  function numCell(ref, value, style) {
    if (num(value) === null) return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '/>';
    return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + '><v>' +
      Number(value) + '</v></c>';
  }

  function colName(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function sheetXml(rows) {
    var last = rows.length + 1;
    var totalRow = last + 1;
    var out = [];
    var total = { km: 0, liters: 0, cost: 0 };

    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    out.push('<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="18"/>');
    out.push('<cols>' +
      '<col min="1" max="1" width="7" customWidth="1"/>' +
      '<col min="2" max="2" width="15" customWidth="1"/>' +
      '<col min="3" max="3" width="14" customWidth="1"/>' +
      '<col min="4" max="4" width="13" customWidth="1"/>' +
      '<col min="5" max="5" width="17" customWidth="1"/>' +
      '<col min="6" max="6" width="14" customWidth="1"/>' +
      '<col min="7" max="7" width="15" customWidth="1"/>' +
      '</cols>');

    out.push('<sheetData>');

    // 表头
    var headers = ['序号', '日期', '里程（公里）', '加油量（升）', '油耗（升/百公里）', '单价（元/升）', '费用合计（元）'];
    out.push('<row r="1" ht="26" customHeight="1">');
    headers.forEach(function (h, i) {
      out.push(strCell(colName(i) + '1', h, 1));
    });
    out.push('</row>');

    // 数据
    rows.forEach(function (r, idx) {
      var rowNo = idx + 2;
      total.km += Number(r.km) || 0;
      total.liters += Number(r.liters) || 0;
      total.cost += Number(r.cost) || 0;

      out.push('<row r="' + rowNo + '" ht="22" customHeight="1">');
      out.push(numCell('A' + rowNo, r.seq, 5));
      out.push(strCell('B' + rowNo, r.date, 5));
      out.push(numCell('C' + rowNo, num(r.km) === null ? null : Math.round(r.km), 3));
      out.push(numCell('D' + rowNo, r.liters, 2));
      out.push(numCell('E' + rowNo, r.cons === null ? null : r.cons, 2));
      out.push(numCell('F' + rowNo, r.price === null ? null : r.price, 2));
      out.push(numCell('G' + rowNo, r.cost, 2));
      out.push('</row>');
    });

    // 合计（和 Excel 里一样的公式）
    out.push('<row r="' + totalRow + '" ht="24" customHeight="1">');
    out.push(strCell('A' + totalRow, '合计', 4));
    out.push('<c r="B' + totalRow + '" s="4"/>');
    out.push('<c r="C' + totalRow + '" s="6"><f>SUM(C2:C' + last + ')</f><v>' + Math.round(total.km) + '</v></c>');
    out.push('<c r="D' + totalRow + '" s="7"><f>SUM(D2:D' + last + ')</f><v>' + (Math.round(total.liters * 1000) / 1000) + '</v></c>');
    out.push('<c r="E' + totalRow + '" s="7"><f>D' + totalRow + '/C' + totalRow + '*100</f><v>' +
      (total.km > 0 ? Math.round(total.liters / total.km * 10000) / 100 : 0) + '</v></c>');
    out.push('<c r="F' + totalRow + '" s="7"><f>G' + totalRow + '/D' + totalRow + '</f><v>' +
      (total.liters > 0 ? Math.round(total.cost / total.liters * 1000) / 1000 : 0) + '</v></c>');
    out.push('<c r="G' + totalRow + '" s="7"><f>SUM(G2:G' + last + ')</f><v>' +
      (Math.round(total.cost * 100) / 100) + '</v></c>');
    out.push('</row>');

    out.push('</sheetData>');
    out.push('<autoFilter ref="A1:G' + last + '"/>');
    out.push('</worksheet>');
    return out.join('');
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.000"/></numFmts>' +
    '<fonts count="3">' +
      '<font><sz val="11"/><name val="Microsoft YaHei"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font>' +
      '<font><b/><sz val="11"/><name val="Microsoft YaHei"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0D1117"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top style="thin"><color rgb="FF9AA4B2"/></top><bottom/><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
        '<alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">' +
        '<alignment horizontal="right"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
        '<alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
      '<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(rows) {
    var files = [
      {
        name: '[Content_Types].xml',
        data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>')
      },
      {
        name: '_rels/.rels',
        data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>')
      },
      {
        name: 'xl/workbook.xml',
        data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="加油记录" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>')
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>')
      },
      { name: 'xl/styles.xml', data: utf8(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(rows)) }
    ];
    return zip(files);
  }

  window.CarXlsx = { build: build };
})();
