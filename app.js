/* ═══════════════════════════════════════════════
   CodeLens — app.js
   Programación Web II · Andres Moreno · 2026
   Integraciones: Groq API + ownCloud WebDAV
═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

  /* ════════════════════════════════════════════
     REFERENCIAS AL DOM
  ════════════════════════════════════════════ */
  var codeta      = document.getElementById('codeta');
  var lninner     = document.getElementById('lninner');
  var lncol       = document.getElementById('lncol');
  var emeta       = document.getElementById('emeta');
  var runBtn      = document.getElementById('runBtn');
  var clearBtn    = document.getElementById('clearBtn');
  var copyBtn     = document.getElementById('copyBtn');
  var langSel     = document.getElementById('langSel');
  var phEl        = document.getElementById('phEl');
  var loaderEl    = document.getElementById('loaderEl');
  var loaderMsg   = document.getElementById('loaderMsg');
  var resultEl    = document.getElementById('resultEl');
  var hlist       = document.getElementById('hlist');
  var hempty      = document.getElementById('hempty');
  var clrhBtn     = document.getElementById('clrhBtn');
  var toastEl     = document.getElementById('toastEl');
  // Gemini — los elementos de UI fueron removidos; la key va directo en el código
  var geminiKeyEl = null;
  var geminiSave  = null;
  var geminiSt    = null;
  // ownCloud
  var ocUrlEl     = document.getElementById('ocUrl');
  var ocUserEl    = document.getElementById('ocUser');
  var ocPassEl    = document.getElementById('ocPass');
  var ocSaveBtn   = document.getElementById('ocSaveBtn');
  var ocStatus    = document.getElementById('owncloudStatus');
  var saveOcBtn   = document.getElementById('saveOcBtn');
  var ocSection   = document.getElementById('ocSection');
  var ocFileList  = document.getElementById('ocFileList');
  var ocRefresh   = document.getElementById('ocRefreshBtn');

  /* ════════════════════════════════════════════
     API KEY — GROQ
     ─────────────────────────────────────────
     1. Ve a https://console.groq.com
     2. Crea una cuenta gratuita (sin tarjeta)
     3. Ve a API Keys → Create API Key
     4. Pega la key aquí abajo
     ─────────────────────────────────────────
  ════════════════════════════════════════════ */
  var GEMINI_KEY = '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';

  /* ════════════════════════════════════════════
     CONFIGURACIÓN — OWNCLOUD
     ownCloud usa WebDAV sobre HTTP.
     Endpoint: {servidor}/remote.php/webdav/{ruta}
     Autenticación: Basic Auth (usuario:contraseña en Base64)
  ════════════════════════════════════════════ */
  var OC = {
    url:  sessionStorage.getItem('cl_oc_url')  || '',
    user: sessionStorage.getItem('cl_oc_user') || '',
    pass: sessionStorage.getItem('cl_oc_pass') || '',
  };

  // Carpeta donde se guardarán los análisis en ownCloud
  var OC_FOLDER = 'CodeLens';

  function updateOcStatus() {
    if (OC.url && OC.user && OC.pass) {
      ocStatus.textContent = '✓ Configurado';
      ocStatus.className   = 'config-badge oc-active';
      ocSection.style.display = 'block';
      cargarArchivosOC();
    } else {
      ocStatus.textContent = 'Sin configurar';
      ocStatus.className   = 'config-badge';
      ocSection.style.display = 'none';
    }
  }

  if (OC.url)  ocUrlEl.value  = OC.url;
  if (OC.user) ocUserEl.value = OC.user;
  if (OC.pass) ocPassEl.value = OC.pass;
  updateOcStatus();

  ocSaveBtn.addEventListener('click', function () {
    var u = ocUrlEl.value.trim().replace(/\/$/, '');
    var user = ocUserEl.value.trim();
    var pass = ocPassEl.value;
    if (!u || !user || !pass) { showToast('Completa URL, usuario y contraseña', false); return; }
    OC.url  = u;
    OC.user = user;
    OC.pass = pass;
    sessionStorage.setItem('cl_oc_url',  u);
    sessionStorage.setItem('cl_oc_user', user);
    sessionStorage.setItem('cl_oc_pass', pass);
    updateOcStatus();
    showToast('ownCloud configurado', true);
  });

  /* ────────────────────────────────────────────
     OWNCLOUD — HELPERS WebDAV

     Todas las operaciones usan el protocolo WebDAV:
     - PUT  → sube / crea un archivo
     - MKCOL → crea una carpeta
     - PROPFIND → lista archivos de una carpeta
     - GET  → descarga un archivo

     URL base WebDAV:
     {OC.url}/remote.php/webdav/{ruta}

     NOTA CORS: si ownCloud está en otro dominio,
     el administrador debe habilitar CORS en el servidor.
     Para desarrollo local no hay problema.
  ────────────────────────────────────────────── */

  // Genera el header Authorization en Base64
  function ocAuthHeader() {
    return 'Basic ' + btoa(OC.user + ':' + OC.pass);
  }

  // URL WebDAV para una ruta dentro de ownCloud
  function ocWebDavUrl(ruta) {
    return OC.url + '/remote.php/webdav/' + ruta;
  }

  // Crear carpeta (MKCOL) — devuelve Promise, no falla si ya existe
  function ocCrearCarpeta(nombre) {
    return fetch(ocWebDavUrl(nombre), {
      method:  'MKCOL',
      headers: { 'Authorization': ocAuthHeader() },
    }).catch(function () { /* ignorar error de red */ });
  }

  // Subir archivo de texto (PUT) — devuelve Promise
  function ocSubirArchivo(ruta, contenido) {
    return fetch(ocWebDavUrl(ruta), {
      method:  'PUT',
      headers: {
        'Authorization': ocAuthHeader(),
        'Content-Type':  'text/plain; charset=utf-8',
      },
      body: contenido,
    }).then(function (resp) {
      if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
        throw new Error('ownCloud respondió con HTTP ' + resp.status);
      }
      return resp;
    });
  }

  // Listar archivos (PROPFIND depth 1) — devuelve Promise<Array>
  function ocListarArchivos(carpeta) {
    var xmlBody = '<?xml version="1.0"?>' +
      '<d:propfind xmlns:d="DAV:">' +
        '<d:prop><d:displayname/><d:getlastmodified/><d:getcontentlength/></d:prop>' +
      '</d:propfind>';

    return fetch(ocWebDavUrl(carpeta + '/'), {
      method:  'PROPFIND',
      headers: {
        'Authorization': ocAuthHeader(),
        'Depth':         '1',
        'Content-Type':  'application/xml',
      },
      body: xmlBody,
    })
    .then(function (resp) {
      if (!resp.ok) throw new Error('No se pudo listar ownCloud (HTTP ' + resp.status + ')');
      return resp.text();
    })
    .then(function (xml) {
      var parser    = new DOMParser();
      var doc       = parser.parseFromString(xml, 'application/xml');
      var responses = Array.from(doc.querySelectorAll('response'));
      var archivos  = [];
      responses.forEach(function (r) {
        var href   = r.querySelector('href') ? r.querySelector('href').textContent.trim() : '';
        var nombre = decodeURIComponent(href.split('/').pop());
        var fecha  = r.querySelector('getlastmodified') ? r.querySelector('getlastmodified').textContent : '';
        var esRaiz = href.endsWith(carpeta + '/') || href.endsWith(carpeta);
        if (!esRaiz && nombre && nombre.endsWith('.txt')) {
          archivos.push({ nombre: nombre, href: href, fecha: fecha });
        }
      });
      return archivos;
    });
  }

  // Guardar análisis en ownCloud
  function guardarEnOC(contenido, lang) {
    if (!OC.url || !OC.user || !OC.pass) {
      showToast('Configura ownCloud primero', false);
      return;
    }
    saveOcBtn.disabled = true;
    showToast('Guardando en ownCloud...', true);

    var ahora  = new Date();
    var fecha  = ahora.getFullYear() + '-' +
                 String(ahora.getMonth()+1).padStart(2,'0') + '-' +
                 String(ahora.getDate()).padStart(2,'0');
    var hora   = String(ahora.getHours()).padStart(2,'0') + '-' +
                 String(ahora.getMinutes()).padStart(2,'0') + '-' +
                 String(ahora.getSeconds()).padStart(2,'0');
    var nombre = 'analisis_' + lang + '_' + fecha + '_' + hora + '.txt';
    var ruta   = OC_FOLDER + '/' + nombre;

    ocCrearCarpeta(OC_FOLDER)
      .then(function () { return ocSubirArchivo(ruta, contenido); })
      .then(function () {
        showToast('✓ Guardado: ' + nombre, true);
        if (window.trackOwnCloud) window.trackOwnCloud();
        cargarArchivosOC();
      })
      .catch(function (err) {
        showToast('Error al guardar: ' + err.message, false);
      })
      .then(function () {
        saveOcBtn.disabled = false;
      });
  }

  // Cargar y mostrar lista de archivos de ownCloud
  function cargarArchivosOC() {
    if (!OC.url || !OC.user || !OC.pass) return;
    ocFileList.innerHTML = '<div class="hempty">Cargando archivos...</div>';

    ocListarArchivos(OC_FOLDER)
      .then(function (archivos) {
        if (archivos.length === 0) {
          ocFileList.innerHTML = '<div class="hempty">Sin archivos guardados aún</div>';
          return;
        }
        var html = '';
        archivos.forEach(function (a) {
          var urlDescarga = OC.url + '/remote.php/webdav/' + OC_FOLDER + '/' + encodeURIComponent(a.nombre);
          var fecha = a.fecha ? new Date(a.fecha).toLocaleDateString('es') : '';
          html += '<div class="oc-file-item">' +
            '<span class="oc-file-icon">📄</span>' +
            '<span class="oc-file-name">' + esc(a.nombre) + '</span>' +
            '<span class="oc-file-date">' + esc(fecha) + '</span>' +
            '<a class="oc-file-dl" href="' + urlDescarga + '" download="' + esc(a.nombre) + '">⬇ Descargar</a>' +
            '</div>';
        });
        ocFileList.innerHTML = html;
      })
      .catch(function (err) {
        ocFileList.innerHTML = '<div class="hempty" style="color:var(--red)">Error: ' + esc(err.message) + '</div>';
      });
  }

  ocRefresh.addEventListener('click', cargarArchivosOC);
  saveOcBtn.addEventListener('click', function () {
    if (lastCopyText) guardarEnOC(lastCopyText, lastLang);
  });

  /* ════════════════════════════════════════════
     EDITOR — NÚMEROS DE LÍNEA
  ════════════════════════════════════════════ */
  function rebuildLines() {
    var lines = codeta.value.split('\n');
    var nums  = [];
    for (var i = 1; i <= lines.length; i++) nums.push(i);
    lninner.textContent = nums.join('\n');
    lncol.scrollTop     = codeta.scrollTop;
    emeta.textContent   = lines.length + ' línea' + (lines.length !== 1 ? 's' : '') +
                          ' · ' + codeta.value.length.toLocaleString() + ' chars';
  }
  codeta.addEventListener('scroll', function () { lncol.scrollTop = codeta.scrollTop; });
  codeta.addEventListener('input', rebuildLines);
  codeta.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = codeta.selectionStart;
      codeta.value = codeta.value.slice(0, s) + '  ' + codeta.value.slice(s);
      codeta.selectionStart = codeta.selectionEnd = s + 2;
      rebuildLines();
    }
  });
  clearBtn.addEventListener('click', function () {
    codeta.value = '';
    rebuildLines();
    showPH();
    copyBtn.style.display   = 'none';
    saveOcBtn.style.display = 'none';
  });
  rebuildLines();

  /* ════════════════════════════════════════════
     ESTADOS DE PANTALLA
  ════════════════════════════════════════════ */
  function showPH() {
    phEl.style.display     = 'flex';
    loaderEl.style.display = 'none';
    resultEl.style.display = 'none';
  }
  function showLoader(msg) {
    loaderMsg.textContent  = msg || 'Analizando...';
    phEl.style.display     = 'none';
    loaderEl.style.display = 'flex';
    resultEl.style.display = 'none';
  }
  function showResult() {
    phEl.style.display     = 'none';
    loaderEl.style.display = 'none';
    resultEl.style.display = 'block';
  }

  /* ════════════════════════════════════════════
     GROQ API
     Endpoint : api.groq.com
     Modelo   : llama-3.3-70b-versatile  (gratis)
     Límite   : 14,400 peticiones / día
     Key en   : https://console.groq.com
  ════════════════════════════════════════════ */
  var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

  function buildPrompt(code, lang) {
    return 'Eres un analizador de código experto y profesor de programación. ' +
      'Analiza el siguiente fragmento de código' + (lang !== 'auto' ? ' en ' + lang : '') + '.\n\n' +
      'Responde ÚNICAMENTE con JSON válido sin texto adicional ni bloques markdown. Estructura exacta:\n\n' +
      '{\n' +
      '  "lenguaje": "nombre del lenguaje",\n' +
      '  "descripcion": "2-3 oraciones: qué hace el código, qué estructuras usa, cuál es su propósito",\n' +
      '  "resumen": "1 oración del estado general",\n' +
      '  "puntuacion": { "calidad": 0, "legibilidad": 0, "practicas": 0 },\n' +
      '  "errores": ["error detallado 1", "error detallado 2"],\n' +
      '  "mejoras": ["sugerencia específica 1", "sugerencia específica 2"],\n' +
      '  "buenas_practicas": ["recomendación 1", "recomendación 2"],\n' +
      '  "conclusion": "el punto más importante a mejorar"\n' +
      '}\n\n' +
      'Puntuaciones de 0-100. Arrays vacíos si no aplica.\n\n' +
      'CÓDIGO:\n```\n' + code + '\n```';
  }

  // Devuelve una Promise que resuelve con el JSON parseado de Groq
  function llamarGroq(code, lang) {
    var body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Eres un analizador de código experto. Responde siempre con JSON puro, sin markdown ni texto adicional.' },
        { role: 'user',   content: buildPrompt(code, lang) }
      ],
      temperature: 0.2,
      max_tokens:  1500,
    });

    return fetch(GROQ_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GEMINI_KEY,  // reutilizamos la variable, ahora guarda la Groq key
      },
      body: body,
    })
    .then(function (resp) {
      if (!resp.ok) {
        return resp.json().then(function (e) {
          var msg = (e.error && e.error.message) ? e.error.message : 'HTTP ' + resp.status;
          throw new Error(msg);
        });
      }
      return resp.json();
    })
    .then(function (data) {
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Respuesta de Groq inesperada: ' + JSON.stringify(data).slice(0, 120));
      }
      var texto = data.choices[0].message.content;
      texto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
      try {
        return JSON.parse(texto);
      } catch (e) {
        throw new Error('Groq devolvió JSON inválido: ' + texto.slice(0, 120));
      }
    });
  }

  function geminiToFormato(g) {
    var sc = g.puntuacion || {};
    return {
      lang:        g.lenguaje || 'desconocido',
      descripcion: g.descripcion || '',
      resumen:     g.resumen || '',
      sc: {
        calidad:     Math.min(100, Math.max(0, Number(sc.calidad)     || 70)),
        legibilidad: Math.min(100, Math.max(0, Number(sc.legibilidad) || 70)),
        practicas:   Math.min(100, Math.max(0, Number(sc.practicas)   || 70)),
      },
      errores: Array.isArray(g.errores)          ? g.errores          : [],
      mejoras: Array.isArray(g.mejoras)          ? g.mejoras          : [],
      bp:      Array.isArray(g.buenas_practicas) ? g.buenas_practicas : [],
      conclusion: g.conclusion || '',
      fuente: 'gemini',
    };
  }

  /* ════════════════════════════════════════════
     ANÁLISIS ESTÁTICO — fallback sin API
  ════════════════════════════════════════════ */
  function detectLang(code) {
    if (/:\s*(string|number|boolean|void|any)\b|interface [A-Z]/.test(code))  return 'typescript';
    if (/\bdef |^\s*from \S+ import|\belif\b|\bprint\s*\(/m.test(code))       return 'python';
    if (/public class |System\.out\.|import java\./.test(code))               return 'java';
    if (/\$[a-zA-Z_]|\becho\b|<\?php/.test(code))                            return 'php';
    if (/\bSELECT\b|\bINSERT INTO\b|\bCREATE TABLE\b/i.test(code))           return 'sql';
    if (/<!DOCTYPE|<html\b/i.test(code))                                      return 'html';
    if (/#include\s*<|printf\s*\(|int\s+main\s*\(/.test(code))               return 'c';
    if (/\bfunction\b|\bconst\b|\blet\b|\bvar\b|=>/.test(code))              return 'javascript';
    if (/[a-z-]+\s*:\s*[^;{]+;/.test(code))                                  return 'css';
    return 'desconocido';
  }

  var RG = [ // reglas generales
    function(c){var n=c.split('\n').filter(function(l){return l.length>100;}).length;return n?{k:'m',m:n+' línea(s) superan 100 chars.'}:null;},
    function(c){var a=c.split('\n').filter(function(l){return l.trim();}).length,cm=c.split('\n').filter(function(l){return/^\s*(\/\/|#|\/\*|\*)/.test(l);}).length;return(a>12&&cm===0)?{k:'m',m:'Sin comentarios. Documenta las secciones importantes.'}:null;},
    function(c){var n=(c.match(/\b(TODO|FIXME|HACK)\b/g)||[]).length;return n?{k:'m',m:n+' marca(s) TODO/FIXME pendiente(s).'}:null;},
    function(c){var n=(c.match(/catch\s*\([^)]*\)\s*\{\s*\}/g)||[]).length;return n?{k:'e',m:n+' catch vacío(s). Nunca silencies excepciones.'}:null;},
    function(c){var x=0,cur=0;for(var i=0;i<c.length;i++){if(c[i]==='{')cur++;else if(c[i]==='}')cur=Math.max(0,cur-1);if(cur>x)x=cur;}return x>6?{k:'e',m:'Anidamiento profundo nivel '+x+'. Extrae bloques a funciones.'}:null;},
    function(c){var ls=c.split('\n').map(function(l){return l.trim();}).filter(function(l){return l.length>20;}),v={},d=0;ls.forEach(function(l){if(v[l])d++;else v[l]=1;});return d>0?{k:'m',m:d+' línea(s) duplicadas. Extrae la lógica a una función.'}:null;},
  ];
  var RL = { // reglas por lenguaje
    javascript:[
      function(c){var n=(c.match(/\bvar\b/g)||[]).length;return n?{k:'e',m:'"var" usado '+n+' vez/veces. Usa "const" o "let".'}:null;},
      function(c){var n=(c.match(/[^=!]={2}[^=]/g)||[]).length;return n?{k:'e',m:n+' comparación(es) con "==". Usa "===".'}:null;},
      function(c){var n=(c.match(/console\.\w+/g)||[]).length;return n?{k:'m',m:n+' console.log encontrado(s).'}:null;},
      function(c){var n=(c.match(/\beval\s*\(/g)||[]).length;return n?{k:'e',m:'eval() inseguro. Evítalo.'}:null;},
    ],
    typescript:[
      function(c){var n=(c.match(/:\s*any\b/g)||[]).length;return n?{k:'m',m:'Tipo "any" usado '+n+' vez/veces.'}:null;},
      function(c){var n=(c.match(/\bvar\b/g)||[]).length;return n?{k:'e',m:'"var" detectado '+n+' vez/veces.'}:null;},
    ],
    python:[
      function(c){var n=(c.match(/\bprint\s*\(/g)||[]).length;return n?{k:'m',m:n+' print(). Usa "logging" en producción.'}:null;},
      function(c){var n=(c.match(/except\s*:/g)||[]).length;return n?{k:'e',m:n+' "except:" desnudo(s).'}:null;},
      function(c){var n=(c.match(/\bglobal\b/g)||[]).length;return n?{k:'m',m:'"global" usado '+n+' vez/veces.'}:null;},
    ],
    java:[
      function(c){var n=(c.match(/public\s+(int|String|double|float)\s+[a-z]/g)||[]).length;return n?{k:'e',m:n+' campo(s) público(s). Usa private + getters/setters.'}:null;},
    ],
    php:[
      function(c){var n=(c.match(/\bmysql_/g)||[]).length;return n?{k:'e',m:'mysql_ deprecado ('+n+'). Usa PDO.'}:null;},
      function(c){var n=(c.match(/echo\s+\$_(GET|POST)/g)||[]).length;return n?{k:'e',m:n+' XSS potencial. Usa htmlspecialchars().'}:null;},
    ],
    sql:[
      function(c){var n=(c.match(/SELECT\s+\*/gi)||[]).length;return n?{k:'m',m:n+' "SELECT *". Especifica columnas.'}:null;},
      function(c){var n=(c.match(/DELETE\s+FROM\s+\w+\s*;/gi)||[]).length;return n?{k:'e',m:'DELETE sin WHERE detectado.'}:null;},
    ],
    html:[
      function(c){var imgs=c.match(/<img[^>]*>/gi)||[],n=imgs.filter(function(t){return!/alt\s*=/.test(t);}).length;return n?{k:'e',m:n+' <img> sin alt.'}:null;},
      function(c){var n=(c.match(/style\s*="/g)||[]).length;return n?{k:'m',m:n+' estilo(s) inline.'}:null;},
    ],
    css:[function(c){var n=(c.match(/!important/g)||[]).length;return n?{k:'m',m:'"!important" usado '+n+' veces.'}:null;}],
    c:[
      function(c){var n=(c.match(/\bgets\s*\(/g)||[]).length;return n?{k:'e',m:'gets() inseguro. Usa fgets().'}:null;},
      function(c){var m=(c.match(/\bmalloc\s*\(/g)||[]).length,f=(c.match(/\bfree\s*\(/g)||[]).length;return(m-f)>0?{k:'e',m:'Fuga de memoria: '+(m-f)+' malloc() sin free().'}:null;},
    ],
  };
  var BP = {
    _g:['Usa nombres descriptivos.','Cada función hace una sola cosa.','Aplica DRY.'],
    javascript:['Prefiere "const".','Usa async/await.'],
    typescript:['Define interfaces.','Evita "any".'],
    python:['Sigue PEP 8.','Escribe docstrings.'],
    java:['Aplica SOLID.'],php:['Usa PDO.'],sql:['Usa índices en WHERE.'],
    html:['Usa etiquetas semánticas.'],css:['Usa variables CSS.'],c:['Inicializa variables.'],
  };

  function buildDescEstatico(code, lang) {
    var a=code.split('\n').filter(function(l){return l.trim();}).length;
    var size=a<15?'pequeño':a<60?'mediano':'extenso';
    var fn=(code.match(/\bfunction\b|\bdef\s+[a-zA-Z]/g)||[]).length;
    var cl=(code.match(/\bclass\b/g)||[]).length;
    var p=['Fragmento <strong>'+size+'</strong> en <strong>'+lang.toUpperCase()+'</strong> con <strong>'+a+'</strong> línea(s) activa(s).'];
    var prop=[];
    if(/\bSELECT\b|\bINSERT\b/i.test(code))prop.push('base de datos');
    if(/fetch\s*\(|axios/.test(code))prop.push('HTTP/API');
    if(/document\.|querySelector/.test(code))prop.push('DOM');
    if(prop.length)p.push('Propósito detectado: <strong>'+prop.join(', ')+'</strong>.');
    var est=[];
    if(cl>0)est.push(cl+' clase(s)');
    if(fn>0)est.push(fn+' función(es)');
    if(/\bfor\b|\bwhile\b/.test(code))est.push('bucles');
    if(/\bif\b|\bswitch\b/.test(code))est.push('condicionales');
    if(est.length)p.push('Contiene: '+est.join(', ')+'.');
    if(/\basync\b|\bawait\b/.test(code))p.push('Usa <strong>programación asíncrona</strong>.');
    return p.join(' ');
  }

  function analizarEstatico(code, sel) {
    var lang  = sel === 'auto' ? detectLang(code) : sel;
    var reglas= RG.concat(RL[lang]||[]);
    var errores=[], mejoras=[];
    reglas.forEach(function(fn){
      try{var r=fn(code);if(r){if(r.k==='e')errores.push(r.m);else mejoras.push(r.m);}}catch(e){}
    });
    var bp  = (BP[lang]||[]).concat(BP._g).slice(0,3);
    var cal = Math.max(10,Math.min(100,Math.round(100-(errores.length*12)-(mejoras.length*4))));
    var leg = Math.max(10,Math.min(100,Math.round(100-(mejoras.length*6))));
    var prac= Math.max(10,Math.min(100,Math.round(100-(errores.length*8))));
    var avg = (cal+leg+prac)/3;
    return {
      lang:        lang,
      descripcion: buildDescEstatico(code, lang),
      resumen:     code.split('\n').length+' línea(s). '+(errores.length?errores.length+' error(es).':'Sin errores críticos.')+' '+mejoras.length+' sugerencia(s).',
      sc:          {calidad:cal,legibilidad:leg,practicas:prac},
      errores:     errores,
      mejoras:     mejoras,
      bp:          bp,
      conclusion:  errores.length>0?'Corrige los '+errores.length+' error(es) primero.':avg>=85?'¡Excelente código!':avg>=65?'Buen trabajo. Aplica las sugerencias.':'Revisión necesaria.',
      fuente:      'estatico',
    };
  }

  /* ════════════════════════════════════════════
     RENDERIZADO
  ════════════════════════════════════════════ */
  var lastCopyText = '';
  var lastLang     = 'desconocido';

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function colorScore(v){ return v>=80?'var(--green)':v>=60?'var(--yel)':'var(--red)'; }
  function itemsHtml(lista){
    var h='<div class="ilist">';
    lista.forEach(function(x,i){h+='<div class="issue"><span class="issue-n">'+String(i+1).padStart(2,'0')+'</span><span>'+esc(x)+'</span></div>';});
    return h+'</div>';
  }

  function renderResult(r) {
    lastLang = r.lang;
    var h = '';

    // Badge fuente
    if (r.fuente === 'gemini') {
      h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-family:var(--mono);font-size:10px;color:var(--green);background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.18);padding:6px 12px;border-radius:6px;width:fit-content;">✦ Analizado con Groq AI</div>';
    } else {
      h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-family:var(--mono);font-size:10px;color:var(--t3);background:var(--s2);border:1px solid var(--b1);padding:6px 12px;border-radius:6px;width:fit-content;">⚙ Análisis estático local</div>';
    }

    // Scores
    h += '<div class="scores">';
    h += '<div class="sc"><div class="sc-v" style="color:'+colorScore(r.sc.calidad)+'">'+r.sc.calidad+'</div><div class="sc-l">Calidad</div></div>';
    h += '<div class="sc"><div class="sc-v" style="color:'+colorScore(r.sc.legibilidad)+'">'+r.sc.legibilidad+'</div><div class="sc-l">Legibilidad</div></div>';
    h += '<div class="sc"><div class="sc-v" style="color:'+colorScore(r.sc.practicas)+'">'+r.sc.practicas+'</div><div class="sc-l">Prácticas</div></div>';
    h += '</div>';

    // ¿Qué hace?
    h += '<div class="rsec"><div class="rsec-t"><div class="sq sb"></div>¿QUÉ HACE ESTE CÓDIGO?</div>';
    h += '<div class="desc-box">'+r.descripcion+'</div></div>';

    // Resumen
    h += '<div class="rsec"><div class="rsec-t"><div class="sq sb"></div>LENGUAJE: '+esc(r.lang.toUpperCase())+'</div>';
    h += '<div class="sumbox">'+esc(r.resumen)+'</div></div>';

    // Errores
    h += '<div class="rsec"><div class="rsec-t"><div class="sq sr"></div>ERRORES ('+r.errores.length+')</div>';
    h += r.errores.length===0?'<div class="ok-msg">✓ No se detectaron errores críticos.</div>':itemsHtml(r.errores);
    h += '</div>';

    // Mejoras
    if(r.mejoras.length>0){h+='<div class="rsec"><div class="rsec-t"><div class="sq sy"></div>SUGERENCIAS ('+r.mejoras.length+')</div>'+itemsHtml(r.mejoras)+'</div>';}

    // Buenas prácticas
    if(r.bp.length>0){h+='<div class="rsec"><div class="rsec-t"><div class="sq sg"></div>BUENAS PRÁCTICAS</div>'+itemsHtml(r.bp)+'</div>';}

    // Conclusión
    h += '<div class="rsec"><div class="rsec-t"><div class="sq sg"></div>CONCLUSIÓN</div>';
    h += '<div class="concl">'+esc(r.conclusion)+'</div></div>';

    resultEl.innerHTML = h;
    showResult();
    copyBtn.style.display   = 'inline-block';
    saveOcBtn.style.display = (OC.url && OC.user && OC.pass) ? 'inline-block' : 'none';

    // Texto para copiar / guardar en ownCloud
    lastCopyText =
      '=== CODELENS — ANÁLISIS ===\n' +
      'Lenguaje : ' + r.lang + '\n' +
      'Fuente   : ' + (r.fuente==='gemini'?'Gemini AI':'Análisis estático') + '\n' +
      'Fecha    : ' + new Date().toLocaleString('es') + '\n\n' +
      '¿QUÉ HACE?\n' + r.descripcion.replace(/<[^>]+>/g,'') + '\n\n' +
      'RESUMEN: ' + r.resumen + '\n' +
      'Calidad: ' + r.sc.calidad + ' | Legibilidad: ' + r.sc.legibilidad + ' | Prácticas: ' + r.sc.practicas + '\n\n' +
      (r.errores.length?'ERRORES:\n'+r.errores.map(function(e,i){return(i+1)+'. '+e;}).join('\n')+'\n\n':'') +
      (r.mejoras.length?'SUGERENCIAS:\n'+r.mejoras.map(function(m,i){return(i+1)+'. '+m;}).join('\n')+'\n\n':'') +
      (r.bp.length?'BUENAS PRÁCTICAS:\n'+r.bp.map(function(b,i){return(i+1)+'. '+b;}).join('\n')+'\n\n':'') +
      'CONCLUSIÓN: ' + r.conclusion + '\n';
  }

  /* ════════════════════════════════════════════
     BOTÓN ANALIZAR
  ════════════════════════════════════════════ */
  runBtn.addEventListener('click', function () {
    var code = codeta.value.trim();
    if (!code) { showToast('Ingresa código primero', false); return; }

    runBtn.disabled = true;

    if (GEMINI_KEY && GEMINI_KEY !== 'INGRESA_TU_GROQ_API_KEY_AQUI') {
      showLoader('Consultando Groq AI...');
      llamarGroq(code, langSel.value)
        .then(function (data) {
          var resultado = geminiToFormato(data);
          renderResult(resultado);
          addHistory(code, resultado.lang);
          if (window.trackAnalysis) window.trackAnalysis(resultado.lang, 'groq');
          showToast('Análisis con IA completado ✓', true);
          runBtn.disabled = false;
        })
        .catch(function (err) {
          console.error('Gemini error:', err);
          // Mostrar el error real en pantalla para depuración
          showToast('Gemini falló: ' + err.message, false);
          // Caer al análisis estático
          var r = analizarEstatico(code, langSel.value);
          renderResult(r);
          addHistory(code, r.lang);
          if (window.trackAnalysis) window.trackAnalysis(r.lang, 'estatico');
          runBtn.disabled = false;
        });
    } else {
      showLoader('Analizando código...');
      setTimeout(function () {
        try {
          var r = analizarEstatico(code, langSel.value);
          renderResult(r);
          addHistory(code, r.lang);
          if (window.trackAnalysis) window.trackAnalysis(r.lang, 'estatico');
          showToast('Análisis completado', true);
        } catch(err) {
          resultEl.innerHTML = '<div style="color:var(--red);font-family:var(--mono);font-size:13px;padding:16px;">Error: '+esc(String(err.message))+'</div>';
          showResult();
          showToast('Error al analizar', false);
        }
        runBtn.disabled = false;
      }, 600);
    }
  });

  /* ════════════════════════════════════════════
     COPIAR
  ════════════════════════════════════════════ */
  copyBtn.addEventListener('click', function () {
    if (!lastCopyText) return;
    navigator.clipboard.writeText(lastCopyText)
      .then(function ()  { showToast('Copiado al portapapeles', true); })
      .catch(function () { showToast('No se pudo copiar', false); });
  });

  /* ════════════════════════════════════════════
     HISTORIAL LOCAL
  ════════════════════════════════════════════ */
  var hist = [];
  try { hist = JSON.parse(localStorage.getItem('cl_hist') || '[]'); } catch(e){ hist=[]; }

  function addHistory(code, lang) {
    hist.unshift({ id:Date.now(), snippet:code.slice(0,120).replace(/\n/g,' ').trim(), lang:lang, time:new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'}) });
    if (hist.length>20) hist.pop();
    try { localStorage.setItem('cl_hist', JSON.stringify(hist)); } catch(e){}
    renderHistory();
  }

  function renderHistory() {
    if (hist.length===0){ hlist.innerHTML=''; hlist.appendChild(hempty); hempty.style.display='block'; return; }
    hempty.style.display='none';
    var html='';
    hist.forEach(function(h){
      html+='<div class="hitem" data-id="'+h.id+'"><span class="hlang">'+esc(h.lang.slice(0,8))+'</span><span class="hsnip">'+esc(h.snippet)+'</span><span class="htime">'+esc(h.time)+'</span></div>';
    });
    hlist.innerHTML=html;
    hlist.querySelectorAll('.hitem').forEach(function(el){
      el.addEventListener('click',function(){
        var id=Number(el.getAttribute('data-id')),item=null;
        for(var j=0;j<hist.length;j++){if(hist[j].id===id){item=hist[j];break;}}
        if(item){codeta.value=item.snippet;rebuildLines();showToast('Código cargado',true);}
      });
    });
  }

  clrhBtn.addEventListener('click',function(){
    hist=[];
    try{localStorage.removeItem('cl_hist');}catch(e){}
    renderHistory();
    showToast('Historial borrado',true);
  });

  /* ════════════════════════════════════════════
     TOAST
  ════════════════════════════════════════════ */
  var toastTimer=null;
  function showToast(msg,ok){
    toastEl.textContent=msg;
    toastEl.className='toast on '+(ok?'ok':'err');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){toastEl.className='toast';},3000);
  }

  /* INIT */
  renderHistory();

}); // fin DOMContentLoaded
