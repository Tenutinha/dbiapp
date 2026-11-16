/**
 * The page the load serves about itself (see live-server.ts): the four steps of the fiscal modeling, the
 * file being read and the table being put together, the totals, and a terminal with every message as it
 * happens. One self-contained document — the load has no build step and no app server next to it — fed by
 * `/eventos` (events "linha", "estado" and "fim").
 *
 * The script inside is plain JavaScript with string concatenation: no template literals, so this file's own
 * template string needs no escaping.
 */
export const LIVE_PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conversão ao vivo · DBI</title>
<style>
  :root {
    --bg: #f6f4f2; --card: #ffffff; --line: #e3ded9; --text: #1d1a18; --muted: #6b635d;
    --accent: #b3261e; --accent-soft: #f6dcd9; --ok: #1b7f4b; --ok-soft: #dcefe4; --warn: #a15c00; --term: #171412; --term-text: #ebe6e1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #151210; --card: #1e1a18; --line: #322c28; --text: #f0ebe6; --muted: #a39a92;
      --accent: #ff8a80; --accent-soft: #3b1f1c; --ok: #6fd39b; --ok-soft: #173326; --warn: #f0b45a; --term: #0e0c0b; --term-text: #e6e0da;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, "Segoe UI", sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 20px 16px 40px; display: flex; flex-direction: column; gap: 16px; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; }
  h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  .muted { color: var(--muted); }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
  .badge.run { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
  .badge.ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
  .badge.fail { background: var(--accent); color: #fff; border-color: transparent; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .run .dot { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .run .dot { animation: none; } .bar > i { transition: none; } }

  .steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; list-style: none; margin: 0; padding: 0; }
  .step { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .step.now { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .step.done { border-color: var(--ok); }
  .step.fail { border-color: var(--accent); background: var(--accent-soft); }
  .step .n { font-size: 12px; color: var(--muted); }
  .step .t { font-weight: 600; }
  .step .where { font-size: 12px; color: var(--muted); }
  .step .s { font-size: 13px; min-height: 19px; overflow-wrap: anywhere; }
  .bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .4s ease; }
  .done .bar > i { background: var(--ok); }

  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; min-width: 0; }
  .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .row { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding: 0; list-style: none; }
  .chip { font-size: 12px; padding: 2px 8px; border-radius: 6px; background: var(--ok-soft); color: var(--ok); }
  .chip.wait { background: transparent; border: 1px dashed var(--line); color: var(--muted); }
  .nums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
  .nums div { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .nums dt { font-size: 12px; color: var(--muted); }
  .nums dd { margin: 0; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-weight: 400; color: var(--muted); padding: 4px 8px 4px 0; }
  td { padding: 4px 8px 4px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  td.r, th.r { text-align: right; }
  td .bar { min-width: 60px; }
  td .bar > i { background: var(--accent); opacity: .7; }
  .empty { color: var(--muted); font-size: 13px; }

  .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
  .tools input[type=search] { flex: 1 1 200px; min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); font: inherit; }
  button, .tools label { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
  button[aria-pressed=true] { border-color: var(--accent); color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #terminal { background: var(--term); color: var(--term-text); border-radius: 10px; padding: 12px; height: 420px; overflow: auto; font: 13px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  #terminal .e { color: #ff9a90; }
  #terminal .o { color: #8fe0b0; }
  #terminal .h { color: #ffd28a; }
  #terminal .c { opacity: .7; }

  @media (max-width: 860px) { .steps, .grid { grid-template-columns: 1fr; } .nums { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
</head>
<body>
<main>
  <header>
    <h1 id="titulo">Conversão ao vivo</h1>
    <span id="fase" class="badge" role="status"><span class="dot"></span><span id="fase-texto">Conectando…</span></span>
    <span id="tempo" class="muted"></span>
  </header>

  <section aria-label="Etapas">
    <ol class="steps">
      <li class="step done" id="s-envio"><span class="n">1</span><span class="t">Envio</span><span class="where">no admin</span><span class="s">Arquivos originais no armazenamento</span><div class="bar"><i style="width:100%"></i></div></li>
      <li class="step" id="s-quebra"><span class="n">2</span><span class="t">Quebra em blocos</span><span class="where">nesta máquina</span><span class="s" id="s-quebra-s">Aguardando</span><div class="bar"><i id="s-quebra-b"></i></div></li>
      <li class="step" id="s-uniao"><span class="n">3</span><span class="t">União por bloco</span><span class="where">nesta máquina</span><span class="s" id="s-uniao-s">Aguardando</span><div class="bar"><i id="s-uniao-b"></i></div></li>
      <li class="step" id="s-pub"><span class="n">4</span><span class="t">Publicação</span><span class="where">nesta máquina → dashboard</span><span class="s" id="s-pub-s">Aguardando</span><div class="bar"><i id="s-pub-b"></i></div></li>
    </ol>
  </section>

  <dl class="nums" aria-label="Totais desta rodada">
    <div><dt>Arquivos lidos</dt><dd id="n-arquivos">0</dd></div>
    <div><dt>Linhas lidas</dt><dd id="n-linhas">0</dd></div>
    <div><dt>Volume lido</dt><dd id="n-volume">0 MB</dd></div>
    <div><dt>Arquivos com erro</dt><dd id="n-erros">0</dd></div>
  </dl>

  <div class="grid">
    <section class="card" aria-labelledby="h-arquivo">
      <h2 id="h-arquivo">Arquivo em leitura</h2>
      <div id="arquivo"><p class="empty">Nenhum arquivo em leitura agora.</p></div>
    </section>
    <section class="card" aria-labelledby="h-tabela">
      <h2 id="h-tabela">Tabela em união</h2>
      <div id="tabela"><p class="empty">Nenhuma tabela em união agora.</p></div>
    </section>
    <section class="card" aria-labelledby="h-blocos">
      <h2 id="h-blocos">Linhas por bloco, somando a cada arquivo</h2>
      <div id="blocos"><p class="empty">Ainda sem arquivos lidos nesta rodada.</p></div>
    </section>
    <section class="card" aria-labelledby="h-prontas">
      <h2 id="h-prontas">Tabelas finais prontas</h2>
      <div id="prontas"><p class="empty">Nenhuma tabela pronta ainda.</p></div>
    </section>
  </div>

  <section aria-labelledby="h-terminal">
    <h2 id="h-terminal">Terminal</h2>
    <div class="tools">
      <input type="search" id="busca" placeholder="Buscar nas mensagens" aria-label="Buscar nas mensagens">
      <button type="button" id="so-erros" aria-pressed="false">Só erros</button>
      <button type="button" id="pausa" aria-pressed="false">Pausar rolagem</button>
      <span class="muted" id="contagem"></span>
    </div>
    <div id="terminal" role="log" aria-live="off" tabindex="0"></div>
  </section>
</main>
<script>
(function () {
  var MAX_LINES = 5000;
  var linhas = [];
  var contagens = {};
  var filtro = { busca: "", erros: false };
  var pausado = false;
  var estado = null;
  var terminal = document.getElementById("terminal");

  function $(id) { return document.getElementById(id); }
  function n(v) { return Number(v || 0).toLocaleString("pt-BR"); }
  function volume(bytes) {
    var mb = (bytes || 0) / 1048576;
    return mb >= 1024 ? (mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " GB" : mb.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB";
  }
  function mes(periodo) { return periodo.slice(5, 7) + "/" + periodo.slice(0, 4); }
  function cnpj(c) { return c.length === 14 ? c.slice(0, 2) + "." + c.slice(2, 5) + "." + c.slice(5, 8) + "/" + c.slice(8, 12) + "-" + c.slice(12) : c; }
  function duracao(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + " h " : "") + (h || m ? m + " min " : "") + r + " s";
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function limpa(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function barra(pct) { var b = el("div", "bar"); var i = el("i"); i.style.width = Math.max(0, Math.min(100, pct)) + "%"; b.appendChild(i); return b; }

  // ---- terminal ----
  function classe(l) {
    var t = l.texto;
    if (t.indexOf("✕") === 0 || /erro|error|falh/i.test(t)) return "e";
    if (t.indexOf("✓") === 0 || t.indexOf("publicado") === 0) return "o";
    if (t.indexOf("▶") === 0) return "h";
    return l.tipo === "contagem" ? "c" : "";
  }
  function passa(l) {
    if (filtro.erros && classe(l) !== "e") return false;
    return !filtro.busca || l.texto.toLowerCase().indexOf(filtro.busca) >= 0;
  }
  function noFim() { return terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 40; }
  function desenha(l) {
    var d = el("div", classe(l), l.texto);
    l.no = d;
    terminal.appendChild(d);
  }
  function redesenha() {
    limpa(terminal);
    var mostradas = 0;
    for (var i = 0; i < linhas.length; i += 1) { linhas[i].no = null; if (passa(linhas[i])) { desenha(linhas[i]); mostradas += 1; } }
    $("contagem").textContent = filtro.erros || filtro.busca ? n(mostradas) + " de " + n(linhas.length) + " mensagens" : n(linhas.length) + " mensagens";
    if (!pausado) terminal.scrollTop = terminal.scrollHeight;
  }
  function chega(l) {
    var chave = l.tipo === "contagem" ? l.texto.split(":")[0] : null;
    var anterior = chave ? contagens[chave] : null;
    if (anterior) {
      // The count of the same file (or table) takes one line, the last one.
      anterior.texto = l.texto;
      if (anterior.no) anterior.no.textContent = l.texto;
      return;
    }
    var segue = !pausado && noFim();
    linhas.push(l);
    if (chave) contagens[chave] = l;
    if (linhas.length > MAX_LINES) { var fora = linhas.shift(); if (fora.no && fora.no.parentNode) fora.no.parentNode.removeChild(fora.no); }
    if (passa(l)) desenha(l);
    if (!filtro.erros && !filtro.busca) $("contagem").textContent = n(linhas.length) + " mensagens";
    if (segue) terminal.scrollTop = terminal.scrollHeight;
  }

  // ---- steps and cards ----
  function etapa(id, modo, texto, pct) {
    var li = $(id);
    li.className = "step" + (modo ? " " + modo : "");
    $(id + "-s").textContent = texto;
    $(id + "-b").style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (modo === "now") li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
  function etapas(e) {
    var v = e.log.live, falhou = e.fase === "falhou", publicado = e.log.published || e.fase === "concluida";
    var st = v ? v.stage : null;
    var lidos = v ? v.files : 0, total = v && v.filesTotal ? v.filesTotal : 0;
    // 2. quebra
    if (st === "quebra" && !publicado) etapa("s-quebra", falhou ? "fail" : "now", falhou ? "Parou em " + n(lidos) + " de " + n(total) : "Lendo: " + n(lidos) + " de " + n(total) + " arquivos", total ? (lidos / total) * 100 : 0);
    else if (st === "uniao" || st === "publicacao" || publicado) etapa("s-quebra", "done", total ? n(lidos) + " arquivo(s) lido(s)" + (v && v.failed ? ", " + n(v.failed) + " com erro" : "") : "Nada a ler: os arquivos já estavam lidos", 100);
    else etapa("s-quebra", falhou ? "fail" : "", falhou ? "Parou antes de começar" : "Preparando a lista de arquivos…", 0);
    // 3. união
    var feitas = v ? v.assembled.length : 0, tabelas = v && v.tablesTotal ? v.tablesTotal : 0;
    if (st === "uniao" && !publicado) etapa("s-uniao", falhou ? "fail" : "now", (falhou ? "Parou em " : "Unindo: ") + n(feitas) + " de " + n(tabelas) + " tabelas", tabelas ? (feitas / tabelas) * 100 : 0);
    else if (st === "publicacao" || publicado) etapa("s-uniao", "done", n(feitas) + " tabela(s) pronta(s)", 100);
    else etapa("s-uniao", "", "Aguardando", 0);
    // 4. publicação
    if (publicado) etapa("s-pub", "done", "Publicado no dashboard", 100);
    else if (st === "publicacao") etapa("s-pub", falhou ? "fail" : "now", falhou ? "A publicação falhou" : "Publicando…", 50);
    else etapa("s-pub", "", falhou ? "Não publicado" : "Aguardando", 0);
  }
  function cartaoArquivo(v) {
    var box = limpa($("arquivo")), f = v ? v.file : null;
    if (!f) { box.appendChild(el("p", "empty", "Nenhum arquivo em leitura agora.")); return; }
    var linha = el("div", "row");
    linha.appendChild(el("strong", "mono", cnpj(f.cnpj)));
    linha.appendChild(el("span", "", mes(f.periodo)));
    linha.appendChild(el("span", "muted", volume(f.sizeBytes)));
    linha.appendChild(el("span", "muted", f.origem === "disco" ? "lido do disco desta máquina" : "baixado do bucket"));
    box.appendChild(linha);
    box.appendChild(el("div", "big", n(f.linhas)));
    box.appendChild(el("div", "muted", "linhas lidas · arquivo " + n(f.posicao) + " de " + n(f.total)));
    var chips = el("ul", "chips");
    if (f.blocos.length === 0) chips.appendChild(el("li", "chip wait", "blocos: gravados ao fim da leitura"));
    for (var i = 0; i < f.blocos.length; i += 1) chips.appendChild(el("li", "chip", f.blocos[i].tabela + " · " + n(f.blocos[i].linhas)));
    box.appendChild(chips);
  }
  function cartaoTabela(v) {
    var box = limpa($("tabela")), t = v ? v.table : null;
    if (!t) { box.appendChild(el("p", "empty", "Nenhuma tabela em união agora.")); return; }
    var fases = { reunindo: "reunindo as partes", juntando: "juntando e ordenando", validando: "validando o contrato" };
    var linha = el("div", "row");
    linha.appendChild(el("strong", "mono", t.tabela));
    linha.appendChild(el("span", "muted", "tabela " + n(t.posicao) + " de " + n(t.total)));
    box.appendChild(linha);
    box.appendChild(el("div", "big", n(t.feitas) + " / " + n(t.partes)));
    box.appendChild(el("div", "muted", "partes reunidas · " + (fases[t.fase] || t.fase)));
    box.appendChild(barra(t.partes ? (t.feitas / t.partes) * 100 : 0));
    if (t.anos.length > 0) {
      var chips = el("ul", "chips");
      for (var i = 0; i < t.anos.length; i += 1) chips.appendChild(el("li", "chip", t.anos[i].ano + " · " + n(t.anos[i].linhas) + (t.anos[i].reaproveitado ? " · reaproveitado" : "")));
      box.appendChild(chips);
    }
  }
  function tabela(cabecalho, linhasDe) {
    var t = el("table"), thead = el("thead"), tr = el("tr");
    for (var i = 0; i < cabecalho.length; i += 1) { var th = el("th", cabecalho[i].r ? "r" : "", cabecalho[i].t); th.scope = "col"; tr.appendChild(th); }
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el("tbody");
    for (var j = 0; j < linhasDe.length; j += 1) tb.appendChild(linhasDe[j]);
    t.appendChild(tb);
    return t;
  }
  function cartaoBlocos(v) {
    var box = limpa($("blocos"));
    if (!v || v.byTable.length === 0) { box.appendChild(el("p", "empty", "Ainda sem arquivos lidos nesta rodada.")); return; }
    var maior = v.byTable[0].rows || 1, trs = [];
    for (var i = 0; i < v.byTable.length; i += 1) {
      var b = v.byTable[i], tr = el("tr");
      tr.appendChild(el("td", "mono", b.table));
      tr.appendChild(el("td", "r", n(b.rows)));
      tr.appendChild(el("td", "r", n(b.files)));
      var td = el("td"); td.appendChild(barra((b.rows / maior) * 100)); tr.appendChild(td);
      trs.push(tr);
    }
    box.appendChild(tabela([{ t: "Bloco" }, { t: "Linhas", r: true }, { t: "Arquivos", r: true }, { t: "" }], trs));
  }
  function cartaoProntas(v) {
    var box = limpa($("prontas"));
    if (!v || v.assembled.length === 0) { box.appendChild(el("p", "empty", "Nenhuma tabela pronta ainda.")); return; }
    var trs = [];
    for (var i = 0; i < v.assembled.length; i += 1) {
      var a = v.assembled[i], tr = el("tr");
      tr.appendChild(el("td", "mono", (a.ok ? "✓ " : "✕ ") + a.table));
      tr.appendChild(el("td", "r", n(a.rows)));
      tr.appendChild(el("td", "r", volume(a.sizeBytes)));
      tr.appendChild(el("td", "r", a.ms === undefined ? "" : duracao(a.ms)));
      trs.push(tr);
    }
    box.appendChild(tabela([{ t: "Tabela" }, { t: "Linhas", r: true }, { t: "Tamanho", r: true }, { t: "Tempo", r: true }], trs));
  }
  function relogio() {
    if (!estado) return;
    var fim = estado.fase === "rodando" ? Date.now() : (estado.recebido || Date.now());
    $("tempo").textContent = "iniciada às " + new Date(estado.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + " · " + duracao(fim - Date.parse(estado.inicio));
  }
  function aplica(e) {
    e.recebido = Date.now();
    estado = e;
    document.title = e.titulo + " · conversão ao vivo";
    $("titulo").textContent = e.titulo;
    var fase = $("fase");
    fase.className = "badge " + (e.fase === "rodando" ? "run" : e.fase === "concluida" ? "ok" : "fail");
    $("fase-texto").textContent = e.fase === "rodando" ? "Rodando" : e.fase === "concluida" ? "Concluída e publicada" : "Parou antes de publicar";
    var v = e.log.live;
    $("n-arquivos").textContent = n(v ? v.files - v.failed : 0);
    $("n-linhas").textContent = n(v ? v.rows : 0);
    $("n-volume").textContent = volume(v ? v.bytes : 0);
    $("n-erros").textContent = n(v ? v.failed : 0);
    etapas(e);
    cartaoArquivo(v);
    cartaoTabela(v);
    cartaoBlocos(v);
    cartaoProntas(v);
    relogio();
  }

  // ---- controls ----
  $("busca").addEventListener("input", function (ev) { filtro.busca = ev.target.value.trim().toLowerCase(); redesenha(); });
  $("so-erros").addEventListener("click", function (ev) { filtro.erros = !filtro.erros; ev.currentTarget.setAttribute("aria-pressed", String(filtro.erros)); redesenha(); });
  $("pausa").addEventListener("click", function (ev) {
    pausado = !pausado;
    ev.currentTarget.setAttribute("aria-pressed", String(pausado));
    ev.currentTarget.textContent = pausado ? "Retomar rolagem" : "Pausar rolagem";
    if (!pausado) terminal.scrollTop = terminal.scrollHeight;
  });
  setInterval(relogio, 1000);

  // ---- stream ----
  var fonte = new EventSource("/eventos");
  fonte.addEventListener("linha", function (ev) { chega(JSON.parse(ev.data)); });
  fonte.addEventListener("estado", function (ev) { aplica(JSON.parse(ev.data)); });
  fonte.addEventListener("fim", function () { fonte.close(); });
  fonte.onerror = function () {
    if (fonte.readyState !== EventSource.CLOSED || !estado || estado.fase !== "rodando") return;
    $("fase").className = "badge fail";
    $("fase-texto").textContent = "Conexão com a conversão encerrada";
  };
})();
</script>
</body>
</html>
`;
