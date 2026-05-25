/**
 * RULETERO 222 - Aplicación Principal
 * Versión GitHub Pages + Firebase
 * 
 * Migrado de Google Apps Script a Firebase Firestore + Auth
 */

// ============ ESTADO GLOBAL ============
var S = {
  user: null,
  posts: [],
  allPosts: [],      // Cache completo para dashboard
  total: 0,
  page: 1,
  tp: 1,
  search: "",
  yearFilter: "todos",
  availableYears: [],
  view: "grid",
  loading: true,
  showDash: false,
  showUsers: false,
  showSettings: false,
  dashData: null,
  users: [],
  settingsData: null,
  pvImg: [],
  pvIdx: 0,
  logoUrl: "",
  editPostData: null,
  fetchedImage: "",
  loginTimeout: null,
  unsubPosts: null   // Firestore listener unsubscribe
};

// ============ CONSTANTES ============
var EMAIL_SUFFIX = "@ruletero222.app";
var POSTS_PER_PAGE = 12;

// ============ HELPERS ============
function logoHTML(cls, size) {
  if (S.logoUrl) {
    return '<div class="' + cls + '"><img src="' + escH(S.logoUrl) + '" alt="RULETERO 222"></div>';
  }
  var fs = size === "lg" ? "32px" : size === "md" ? "16px" : "12px";
  return '<div class="' + cls + '" style="font-size:' + fs + '">R</div>';
}

function escH(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toast(m, t) {
  t = t || "info";
  var c = document.getElementById("toastC"), d = document.createElement("div");
  d.className = "to to" + (t === "success" ? "s" : t === "error" ? "e" : "i");
  d.textContent = m;
  c.appendChild(d);
  setTimeout(function () {
    d.style.opacity = "0"; d.style.transition = "opacity .3s";
    setTimeout(function () { d.remove(); }, 300);
  }, 4000);
}

function togglePw(id, b) {
  var i = document.getElementById(id);
  if (!i) return;
  if (i.type === "password") { i.type = "text"; b.textContent = "\u{1F512}"; b.title = "Ocultar"; }
  else { i.type = "password"; b.textContent = "\u{1F441}"; b.title = "Mostrar"; }
}

function _roleLabel(r) { return { admin: "Administrador", gestionador: "Gestionador", viewer: "Visualizador" }[r] || r; }
function _roleIcon(r) { return r === "admin" ? "\u{1F6E1}" : r === "gestionador" ? "\u270F\uFE0F" : "\u{1F441}"; }
function _roleBadgeCls(r) { return r === "admin" ? "ra" : r === "gestionador" ? "rg" : "rv"; }
function _roleUVCls(r) { return r === "admin" ? "ad" : r === "gestionador" ? "gst" : "vi"; }

// ============ FIRESTORE HELPERS ============
function _usernameToEmail(u) { return u.toLowerCase().trim() + EMAIL_SUFFIX; }
function _emailToUsername(e) { return e.replace(EMAIL_SUFFIX, ""); }

function _classify(text, title) {
  var c = ((text || "") + " " + (title || "")).toLowerCase();
  var hk = ["historia", "histórico", "antiguo", "siglo", "época", "patrimonio", "tradicional", "tradición", "museo", "monumento", "fundación", "conquista", "revolución", "independencia", "prehispánico", "arqueológ", "restauración", "legado", "pasado", "conmemor", "homenaje", "puebla", "poblano", "cholula"];
  var ck = ["cultural", "cultura", "arte", "exposición", "pintura", "escultura", "danza", "música", "teatro", "literatura", "cine", "festival", "feria", "artesanía", "gastronomía", "cocina", "mole", "folklor", "artista"];
  var sk = ["social", "comunidad", "evento", "convivencia", "fiesta", "celebración", "apoyo", "solidaridad", "donación", "voluntariado", "derechos", "educación", "salud", "deporte", "convocatoria", "participa"];
  var h = 0, cu = 0, s = 0;
  for (var i = 0; i < hk.length; i++) { if (c.indexOf(hk[i]) > -1) h++; }
  for (var i = 0; i < ck.length; i++) { if (c.indexOf(ck[i]) > -1) cu++; }
  for (var i = 0; i < sk.length; i++) { if (c.indexOf(sk[i]) > -1) s++; }
  var m = Math.max(h, cu, s);
  if (m === 0) return "sin_clasificar";
  if (h === m) return "historico";
  if (cu === m) return "cultural";
  return "social";
}

function _catLabel(c) { return { historico: "Histórico", cultural: "Cultural", social: "Social", sin_clasificar: "Sin Clasificar" }[c] || c; }
function _catColor(c) { return { historico: "#002B5C", cultural: "#D4AF37", social: "#87CEFA", sin_clasificar: "#9CA3AF" }[c] || "#9CA3AF"; }

// ============ OG METADATA FETCH (via CORS proxy) ============
async function fetchPostMeta(url) {
  try {
    if (!url) return { ok: false, error: "URL requerida" };

    var meta = { image: "", title: "", description: "" };

    // Intentar con proxy CORS
    var proxyUrls = [
      "https://api.allorigins.win/get?url=",
      "https://corsproxy.io/?"
    ];

    var html = null;
    for (var p = 0; p < proxyUrls.length; p++) {
      try {
        var proxyUrl = proxyUrls[p] + encodeURIComponent(url);
        var response = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) continue;
        var data = await response.json();
        html = data.contents || data;
        if (html && html.length > 100) break;
        html = null;
      } catch (e) {
        continue;
      }
    }

    if (!html) return { ok: true, meta: meta };

    // Extraer og:image
    var ogImgMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (!ogImgMatch) ogImgMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImgMatch) meta.image = _htmlDecode(ogImgMatch[1]);

    // Extraer og:title
    var ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (!ogTitleMatch) ogTitleMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogTitleMatch) meta.title = _htmlDecode(ogTitleMatch[1]);

    // Extraer og:description
    var ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    if (!ogDescMatch) ogDescMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    if (ogDescMatch) meta.description = _htmlDecode(ogDescMatch[1]);

    // Fallback: twitter:image
    if (!meta.image) {
      var twImgMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
      if (!twImgMatch) twImgMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
      if (twImgMatch) meta.image = _htmlDecode(twImgMatch[1]);
    }

    // Fallback: buscar <img> con src relevante
    if (!meta.image) {
      var imgMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi);
      if (imgMatches) {
        for (var j = 0; j < Math.min(imgMatches.length, 5); j++) {
          var srcMatch = imgMatches[j].match(/src=["']([^"']+)["']/i);
          if (srcMatch) {
            var src = srcMatch[1];
            if (src.indexOf("scontent") > -1 || src.indexOf("fbcdn") > -1 || src.indexOf("emoji") === -1) {
              meta.image = _htmlDecode(src);
              break;
            }
          }
        }
      }
    }

    return { ok: true, meta: meta };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _htmlDecode(str) {
  if (!str) return str;
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ============ AUTH ============
function clearS() {
  localStorage.removeItem("rt_tk");
  localStorage.removeItem("rt_u");
  localStorage.removeItem("rt_lu");
  S.user = null; S.token = null; S.logoUrl = "";
}

function renderLogin() {
  var a = document.getElementById("app");
  a.innerHTML = '<div class="lc"><div class="lk">' + logoHTML("lo", "lg") +
    '<h1 class="lt">RULETERO 222</h1><p class="ls">La Ruta de los Poblanos</p>' +
    '<div id="lErr" class="lerr"></div>' +
    '<div class="fg"><label class="fl">Usuario</label><input type="text" id="lUser" class="fi" placeholder="Ingresa tu usuario" autocomplete="username"></div>' +
    '<div class="fg"><label class="fl">Contraseña</label><div class="pw"><input type="password" id="lPass" class="fi" placeholder="Ingresa tu contraseña" autocomplete="current-password"><button type="button" class="pt" onclick="togglePw(\'lPass\',this)" title="Mostrar/ocultar">\u{1F441}</button></div></div>' +
    '<button class="btn bp" id="lBtn" onclick="doLogin()"><span id="lTxt">Iniciar Sesión</span></button>' +
    '<p style="text-align:center;font-size:11px;color:var(--m);margin-top:16px;">Acceso exclusivo para miembros del equipo</p>' +
    '<div class="lreset"><a onclick="clearS();toast(\'Sesión limpiada\',\'info\')">Limpiar sesión guardada</a></div>' +
    '</div></div>';

  var passField = document.getElementById("lPass");
  if (passField) passField.addEventListener("keypress", function (e) { if (e.key === "Enter") doLogin(); });
  var userField = document.getElementById("lUser");
  if (userField) userField.addEventListener("keypress", function (e) { if (e.key === "Enter") document.getElementById("lPass").focus(); });
  if (userField) setTimeout(function () { userField.focus(); }, 100);
}

async function doLogin() {
  var u = document.getElementById("lUser").value.trim(),
    p = document.getElementById("lPass").value,
    er = document.getElementById("lErr"),
    b = document.getElementById("lBtn"),
    txt = document.getElementById("lTxt");

  if (!u || !p) {
    er.textContent = "Ingresa usuario y contraseña";
    er.className = "lerr show";
    return;
  }

  b.disabled = true;
  txt.innerHTML = '<span class="sp spw" style="width:16px;height:16px;border-width:2px;"></span> Verificando...';
  er.className = "lerr";

  // Timeout de 30 segundos
  if (S.loginTimeout) clearTimeout(S.loginTimeout);
  S.loginTimeout = setTimeout(function () {
    if (b.disabled) {
      b.disabled = false;
      txt.textContent = "Iniciar Sesión";
      er.textContent = "El servidor no respondió. Intenta de nuevo.";
      er.className = "lerr show";
    }
  }, 30000);

  try {
    // Buscar usuario en Firestore primero para obtener el email
    var userDoc = await db.collection("users").where("username", "==", u.toLowerCase()).limit(1).get();

    if (userDoc.empty) {
      if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
      er.textContent = "Usuario no encontrado";
      er.className = "lerr show";
      b.disabled = false;
      txt.textContent = "Iniciar Sesión";
      return;
    }

    var userData = userDoc.docs[0].data();
    if (!userData.active) {
      if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
      er.textContent = "Tu cuenta está desactivada. Contacta al administrador.";
      er.className = "lerr show";
      b.disabled = false;
      txt.textContent = "Iniciar Sesión";
      return;
    }

    // Autenticar con Firebase Auth
    var email = _usernameToEmail(u);
    var cred = await auth.signInWithEmailAndPassword(email, p);
    var firebaseUser = cred.user;

    // Construir objeto de usuario para la app
    S.user = {
      id: userDoc.id,
      uid: firebaseUser.uid,
      username: userData.username,
      name: userData.name,
      role: userData.role
    };
    S.token = await firebaseUser.getIdToken();

    localStorage.setItem("rt_tk", S.token);
    localStorage.setItem("rt_u", JSON.stringify(S.user));

    // Cargar datos iniciales
    await _loadInitialData();

    if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
    renderApp();
    renderPosts();
    renderPag();

  } catch (e) {
    if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
    var msg = "Error de conexión";
    if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
      msg = "Usuario o contraseña incorrectos";
    } else if (e.code === "auth/too-many-requests") {
      msg = "Demasiados intentos. Espera un momento.";
    } else if (e.message) {
      msg = e.message;
    }
    er.textContent = msg;
    er.className = "lerr show";
    b.disabled = false;
    txt.textContent = "Iniciar Sesión";
  }
}

async function _loadInitialData() {
  try {
    // Cargar logo
    var cfgDoc = await db.collection("config").doc("app").get();
    if (cfgDoc.exists && cfgDoc.data().logoUrl) {
      S.logoUrl = cfgDoc.data().logoUrl;
      localStorage.setItem("rt_lu", S.logoUrl);
    }

    // Cargar posts
    await _fetchPostsFromFirestore();
    S.loading = false;
  } catch (e) {
    console.error("Error cargando datos iniciales:", e);
    S.loading = false;
  }
}

function doLogout() {
  auth.signOut().then(function () {
    clearS();
    renderLogin();
  }).catch(function () {
    clearS();
    renderLogin();
  });
}

// ============ SESSION RECOVERY ============
function init() {
  var lu = localStorage.getItem("rt_lu");
  if (lu) S.logoUrl = lu;

  // Cargar logo público
  _fetchLogo();

  // Verificar si hay sesión activa en Firebase Auth
  auth.onAuthStateChanged(function (firebaseUser) {
    if (firebaseUser) {
      // Mostrar loading mientras validamos
      var a = document.getElementById("app");
      a.innerHTML = '<div class="lss"><div style="text-align:center"><div class="sp" style="width:40px;height:40px;margin:0 auto 16px"></div><div style="color:#64748b;font-size:14px">Verificando sesión...</div><div style="margin-top:12px"><a href="#" onclick="forceShowLogin();return false;" style="color:#94a3b8;font-size:12px">Iniciar sesión manualmente</a></div></div></div>';

      // Recuperar datos del usuario desde Firestore
      _recoverSession(firebaseUser);
    } else {
      clearS();
      renderLogin();
    }
  });
}

async function _recoverSession(firebaseUser) {
  try {
    var storedUser = localStorage.getItem("rt_u");
    if (storedUser) {
      var parsed = JSON.parse(storedUser);
      // Verificar que el usuario aún existe y está activo en Firestore
      var userDoc = await db.collection("users").doc(parsed.id).get();
      if (userDoc.exists) {
        var ud = userDoc.data();
        if (ud.active) {
          S.user = {
            id: userDoc.id,
            uid: firebaseUser.uid,
            username: ud.username,
            name: ud.name,
            role: ud.role
          };
          S.token = await firebaseUser.getIdToken();
          localStorage.setItem("rt_u", JSON.stringify(S.user));

          await _loadInitialData();
          renderApp();
          renderPosts();
          renderPag();
          loadYears();
          return;
        }
      }
    }
    // Si no se pudo recuperar la sesión
    clearS();
    renderLogin();
  } catch (e) {
    console.error("Error recuperando sesión:", e);
    clearS();
    renderLogin();
  }
}

function forceShowLogin() {
  auth.signOut();
  clearS();
  renderLogin();
}

async function _fetchLogo() {
  try {
    var cfgDoc = await db.collection("config").doc("app").get();
    if (cfgDoc.exists && cfgDoc.data().logoUrl) {
      S.logoUrl = cfgDoc.data().logoUrl;
      localStorage.setItem("rt_lu", S.logoUrl);
      var loginLogo = document.querySelector(".lo");
      if (loginLogo && document.getElementById("lUser")) {
        loginLogo.innerHTML = '<img src="' + escH(S.logoUrl) + '" alt="RULETERO 222">';
      }
    }
  } catch (e) { /* silencioso */ }
}

// ============ POSTS - FIRESTORE ============
async function _fetchPostsFromFirestore(bustCache) {
  try {
    var snapshot = await db.collection("posts").orderBy("createdAt", "desc").get();
    S.allPosts = [];
    snapshot.forEach(function (doc) {
      var d = doc.data();
      S.allPosts.push({
        id: doc.id,
        url: d.url || "",
        postText: d.postText || "",
        postDate: d.postDate || "",
        pageTitle: d.pageTitle || "",
        category: d.category || "sin_clasificar",
        addedBy: d.addedBy || "Anónimo",
        createdAt: d.createdAt || "",
        images: d.images || []
      });
    });
    _applyFilters();
  } catch (e) {
    console.error("Error cargando posts:", e);
    toast("Error cargando publicaciones", "error");
    S.loading = false;
  }
}

function _applyFilters() {
  var filtered = S.allPosts.slice();

  // Filtro por año
  if (S.yearFilter && S.yearFilter !== "todos") {
    filtered = filtered.filter(function (p) {
      var d = p.postDate || p.createdAt || "";
      return d.substring(0, 4) === S.yearFilter;
    });
  }

  // Filtro por búsqueda
  if (S.search && S.search.trim()) {
    var sl = S.search.toLowerCase();
    filtered = filtered.filter(function (p) {
      return (p.postText || "").toLowerCase().indexOf(sl) > -1 ||
        (p.url || "").toLowerCase().indexOf(sl) > -1 ||
        (p.pageTitle || "").toLowerCase().indexOf(sl) > -1 ||
        (p.addedBy || "").toLowerCase().indexOf(sl) > -1;
    });
  }

  S.total = filtered.length;
  S.tp = Math.ceil(S.total / POSTS_PER_PAGE) || 1;
  var start = (S.page - 1) * POSTS_PER_PAGE;
  S.posts = filtered.slice(start, start + POSTS_PER_PAGE);
  S.loading = false;
}

function fetchP(bustCache) {
  S.loading = true;
  renderPosts();
  _fetchPostsFromFirestore(bustCache).then(function () {
    renderPosts();
    renderPag();
    updateCounter();
  });
}

function updateCounter() {
  var el = document.querySelector(".tc");
  if (el) el.textContent = S.total + " publicaciones";
}

// ===== OPTIMISTIC UPDATES (igual que original) =====
function onPostAdded(r, url, txt, dt, ttl, imgs, selCat) {
  var newPost = {
    id: r.id, url: url, postText: txt, postDate: dt, pageTitle: ttl,
    category: r.category || selCat || "sin_clasificar", addedBy: S.user.name,
    createdAt: new Date().toISOString(), images: imgs
  };
  S.allPosts.unshift(newPost);
  S.total++;
  S.tp = Math.ceil(S.total / POSTS_PER_PAGE) || 1;
  _applyFilters();
  renderPosts(); renderPag(); updateCounter();
  loadYears();
}

function onPostUpdated(postId, url, txt, dt, ttl, cat, imgs) {
  for (var i = 0; i < S.allPosts.length; i++) {
    if (S.allPosts[i].id === postId) {
      S.allPosts[i].url = url; S.allPosts[i].postText = txt; S.allPosts[i].postDate = dt;
      S.allPosts[i].pageTitle = ttl; S.allPosts[i].category = cat; S.allPosts[i].images = imgs;
      break;
    }
  }
  _applyFilters();
  renderPosts();
}

function onPostDeleted(id) {
  S.allPosts = S.allPosts.filter(function (p) { return p.id !== id; });
  S.total = Math.max(0, S.total - 1);
  S.tp = Math.ceil(S.total / POSTS_PER_PAGE) || 1;
  _applyFilters();
  renderPosts(); renderPag(); updateCounter();
}

// ============ POSTS CRUD ============
function catBadge(c) {
  var m = { historico: ["Histórico", "bh"], cultural: ["Cultural", "bc"], social: ["Social", "bs2"], sin_clasificar: ["Sin Clasificar", "bx"] };
  var v = m[c] || m.sin_clasificar;
  return '<span class="cb ' + v[1] + '">' + v[0] + '</span>';
}

function postButtons(p, ad, canEdit) {
  if (!canEdit && !ad) return '<div class="pa"><a href="' + escH(p.url) + '" target="_blank" class="btn bo bs">\u{1F517} Abrir</a></div>';
  var h = '<div class="pa"><a href="' + escH(p.url) + '" target="_blank" class="btn bo bs">\u{1F517} Abrir</a>';
  if (canEdit) h += '<button class="btn bw bs" onclick="openEditPost(\'' + p.id + '\')">\u270F\uFE0F Editar</button>';
  if (ad) h += '<button class="btn bd bs" onclick="delPost(\'' + p.id + '\')">\u{1F5D1} Eliminar</button>';
  h += '</div>';
  return h;
}

async function delPost(id) {
  if (!confirm("¿Eliminar este post?")) return;
  try {
    await db.collection("posts").doc(id).delete();
    toast("\u2705 Post eliminado", "success");
    onPostDeleted(id);
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
}

// ============ RENDER POSTS ============
function renderPosts() {
  var c = document.getElementById("pC"); if (!c) return;
  if (S.loading) {
    c.innerHTML = '<div class="' + (S.view === "grid" ? "pg" : "pl") + '">' +
      Array(6).fill('<div style="background:var(--cb);border-radius:var(--r);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);"><div style="height:180px;background:#f1f5f9;"></div><div style="padding:16px;"><div style="height:14px;background:#f1f5f9;border-radius:4px;margin-bottom:8px;width:75%;"></div><div style="height:12px;background:#f1f5f9;border-radius:4px;width:50%;"></div></div></div>').join("") +
      '</div>';
    return;
  }
  if (S.posts.length === 0) {
    c.innerHTML = '<div class="es"><div class="ei">\u{1F4DD}</div><div class="et">Sin publicaciones</div><div class="ex">Agrega tu primer post de Facebook</div></div>';
    return;
  }
  var h = "";
  var ad = S.user && S.user.role === "admin", canEdit = ad || (S.user && S.user.role === "gestionador");
  if (S.view === "grid") {
    h = '<div class="pg">';
    for (var i = 0; i < S.posts.length; i++) {
      var p = S.posts[i]; var img = p.images && p.images.length > 0 ? p.images[0] : "";
      h += '<div class="pc">' +
        (img ? '<div class="pi" onclick="pvImg(' + i + ')">' + catBadge(p.category) + (p.images.length > 1 ? '<span class="ic">' + p.images.length + ' \u{1F4F7}</span>' : '') + '<img src="' + escH(img) + '" alt="Post" loading="lazy"></div>' : '<div class="pn">' + catBadge(p.category) + '<span style="font-size:40px;color:#cbd5e1;">\u{1F4DD}</span></div>') +
        '<div class="pb"><div class="pjt">' + escH(p.pageTitle || p.postText || "Sin título") + '</div>' +
        (p.postText && p.pageTitle ? '<div class="pjt2">' + escH(p.postText) + '</div>' : '') +
        '<div class="pm"><span>\u{1F4C5} ' + (p.postDate || "Sin fecha") + '</span><span>\u{1F464} ' + escH(p.addedBy) + '</span></div>' +
        postButtons(p, ad, canEdit) + '</div></div>';
    }
    h += '</div>';
  } else {
    h = '<div class="pl">';
    for (var i = 0; i < S.posts.length; i++) {
      var p = S.posts[i]; var img = p.images && p.images.length > 0 ? p.images[0] : "";
      h += '<div class="pli">' +
        (img ? '<div class="plm" onclick="pvImg(' + i + ')"><img src="' + escH(img) + '" alt="Post" loading="lazy"></div>' : '') +
        '<div class="plb"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' + catBadge(p.category) +
        '<strong style="font-size:14px;color:var(--n);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escH(p.pageTitle || "Sin título") + '</strong></div>' +
        (p.postText ? '<div class="pjt2">' + escH(p.postText) + '</div>' : '') +
        '<div class="pm"><span>\u{1F4C5} ' + (p.postDate || "Sin fecha") + '</span><span>\u{1F464} ' + escH(p.addedBy) + '</span></div>' +
        postButtons(p, ad, canEdit) + '</div></div>';
    }
    h += '</div>';
  }
  c.innerHTML = h;
}

function renderPag() {
  var c = document.getElementById("pgC"); if (!c) return;
  if (S.tp <= 1) { c.innerHTML = ""; return; }
  var h = '<div class="pg2"><button ' + (S.page <= 1 ? "disabled" : "") + ' onclick="goP(' + (S.page - 1) + ')">\u2190 Anterior</button>';
  var s = Math.max(1, S.page - 2), e = Math.min(S.tp, S.page + 2);
  for (var i = s; i <= e; i++) { h += '<button class="' + (i === S.page ? "ac" : "") + '" onclick="goP(' + i + ')">' + i + '</button>'; }
  h += '<button ' + (S.page >= S.tp ? "disabled" : "") + ' onclick="goP(' + (S.page + 1) + ')">Siguiente \u2192</button></div>';
  c.innerHTML = h;
}

function goP(p) { S.page = p; _applyFilters(); renderPosts(); renderPag(); }
function doSearch(v) { S.search = v; S.page = 1; _applyFilters(); renderPosts(); renderPag(); updateCounter(); }
function doYearFilter(v) { S.yearFilter = v; S.page = 1; _applyFilters(); renderPosts(); renderPag(); updateCounter(); }
function setV(v) { S.view = v; renderPosts(); }

async function loadYears() {
  try {
    var years = {};
    for (var i = 0; i < S.allPosts.length; i++) {
      var d = S.allPosts[i].postDate || S.allPosts[i].createdAt || "";
      var y = d.substring(0, 4);
      if (y && y.length === 4) years[y] = true;
    }
    S.availableYears = Object.keys(years).sort();
    renderYearFilter();
  } catch (e) { /* silencioso */ }
}

function renderYearFilter() {
  var sel = document.getElementById("yFilter");
  if (!sel) return;
  var cur = S.yearFilter;
  var h = '<option value="todos">Todos los años</option>';
  for (var i = 0; i < S.availableYears.length; i++) {
    h += '<option value="' + S.availableYears[i] + '"' + (S.availableYears[i] === cur ? " selected" : "") + '>' + S.availableYears[i] + '</option>';
  }
  sel.innerHTML = h;
}

// ============ IMAGE PREVIEW ============
function pvImg(idx) { S.pvImg = S.posts[idx].images || []; S.pvIdx = 0; renderPv(); }
function renderPv() {
  if (!S.pvImg.length) return; var src = S.pvImg[S.pvIdx];
  var d = document.createElement("div"); d.className = "ipo"; d.id = "pvO";
  d.innerHTML = '<img src="' + escH(src) + '" alt="Imagen"><button class="ipc" onclick="closePv()">\u2715</button>' +
    (S.pvImg.length > 1 ? '<button class="ipn pv" onclick="pvNav(-1)">\u2190</button><button class="ipn nx" onclick="pvNav(1)">\u2192</button><div class="ipk">' + (S.pvIdx + 1) + ' / ' + S.pvImg.length + '</div>' : '');
  document.body.appendChild(d);
}
function pvNav(dir) { S.pvIdx = (S.pvIdx + dir + S.pvImg.length) % S.pvImg.length; var o = document.getElementById("pvO"); if (o) o.remove(); renderPv(); }
function closePv() { var o = document.getElementById("pvO"); if (o) o.remove(); }

// ============ FETCH IMAGE PREVIEW (FORM) ============
async function doFetchMeta(urlField, prvId, titleField) {
  var url = document.getElementById(urlField).value.trim();
  if (!url) { toast("Ingresa una URL primero", "error"); return; }
  var prv = document.getElementById(prvId);
  if (prv) prv.innerHTML = '<div class="iph"><div class="sp" style="width:24px;height:24px;margin:0 auto 8px;"></div><br>Obteniendo vista previa...</div>';

  var r = await fetchPostMeta(url);
  if (r.ok && r.meta) {
    S.fetchedImage = r.meta.image || "";
    if (prv) {
      if (r.meta.image) {
        prv.innerHTML = '<img src="' + escH(r.meta.image) + '" alt="Vista previa"><button class="ipl" onclick="clearFetchPreview(\'' + prvId + '\')">\u2715 Quitar</button>';
      } else {
        prv.innerHTML = '<div class="iph">\u{1F4DD} No se encontró imagen en esta URL.<br>El post se guardará sin vista previa.</div>';
      }
    }
    if (titleField) {
      var tf = document.getElementById(titleField);
      if (tf && !tf.value.trim() && r.meta.title) tf.value = r.meta.title;
    }
    toast(r.meta.image ? "\u2705 Imagen encontrada" : "\u2139\uFE0F Sin imagen detectada", r.meta.image ? "success" : "info");
  } else {
    if (prv) prv.innerHTML = '<div class="iph">\u26A0\uFE0F No se pudo obtener la vista previa</div>';
    toast("No se pudo obtener la vista previa", "error");
  }
}

function clearFetchPreview(prvId) {
  var prv = document.getElementById(prvId);
  if (prv) prv.innerHTML = '<div class="iph">\u{1F4F7} La imagen se obtendrá automáticamente del enlace</div>';
  S.fetchedImage = "";
}

// ============ ADD POST ============
function openAdd() {
  S.fetchedImage = "";
  var d = document.createElement("div"); d.id = "addM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>\u2795 Agregar Post</h3><button class="mc" onclick="clM(\'addM\')">\u2715</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">URL del post de Facebook</label><div style="display:flex;gap:8px;"><input type="url" id="aUrl" class="fi" placeholder="https://www.facebook.com/..." style="flex:1"><button class="btn bg bs" onclick="doFetchMeta(\'aUrl\',\'aPrv\',\'aTitle\')" style="white-space:nowrap">\u{1F50D} Vista previa</button></div></div>' +
    '<div id="aPrv" class="iprv"><div class="iph">\u{1F4F7} La imagen se obtendrá automáticamente del enlace</div></div>' +
    '<div class="fg"><label class="fl">Texto del post</label><textarea id="aText" class="fi" rows="4" placeholder="Copia el texto del post aquí"></textarea></div>' +
    '<div class="fg"><label class="fl">Fecha del post</label><input type="date" id="aDate" class="fi"></div>' +
    '<div class="fg"><label class="fl">Título / Página</label><input type="text" id="aTitle" class="fi" placeholder="Nombre de la página o título"></div>' +
    '<div class="fg"><label class="fl">Categoría</label><select id="aCat" class="fi"><option value="auto">\u{1F3AF} Automático (según palabras clave)</option><option value="historico">Histórico</option><option value="cultural">Cultural</option><option value="social">Social</option><option value="sin_clasificar">Sin Clasificar</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'addM\')">Cancelar</button><button class="btn bp" id="aBtn" onclick="doAdd()" style="width:auto">\u{1F4BE} Guardar</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doAdd() {
  var url = document.getElementById("aUrl").value.trim(),
    txt = document.getElementById("aText").value,
    dt = document.getElementById("aDate").value,
    ttl = document.getElementById("aTitle").value.trim(),
    selCat = document.getElementById("aCat").value;
  var imgs = S.fetchedImage ? [S.fetchedImage] : [];
  if (!url) { toast("La URL es requerida", "error"); return; }
  var b = document.getElementById("aBtn"); b.disabled = true; b.textContent = "Guardando...";

  try {
    var cat = (selCat && selCat !== "auto") ? selCat : _classify(txt, ttl);

    // Auto-fetch OG image si no hay
    if (imgs.length === 0 && url) {
      try {
        var meta = await fetchPostMeta(url);
        if (meta.ok && meta.meta && meta.meta.image) imgs = [meta.meta.image];
        if (!ttl && meta.ok && meta.meta && meta.meta.title) ttl = meta.meta.title;
      } catch (e) { /* silencioso */ }
    }

    var docRef = await db.collection("posts").add({
      url: url, postText: txt, postDate: dt, pageTitle: ttl,
      category: cat, addedBy: S.user.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      images: imgs
    });

    toast("\u2705 Post agregado — Clasificación: " + cat, "success");
    clM("addM"); S.fetchedImage = "";
    onPostAdded({ id: docRef.id, category: cat }, url, txt, dt, ttl, imgs, selCat);
  } catch (e) {
    toast("Error: " + e.message, "error");
    b.disabled = false; b.textContent = "\u{1F4BE} Guardar";
  }
}

// ============ EDIT POST ============
function openEditPost(postId) {
  var post = S.posts.find(function (x) { return x.id === postId; });
  if (!post) { toast("Post no encontrado", "error"); return; }
  S.editPostData = post;
  S.fetchedImage = post.images && post.images.length > 0 ? post.images[0] : "";
  var currentImg = S.fetchedImage;
  var d = document.createElement("div"); d.id = "editPM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>\u270F\uFE0F Editar Post</h3><button class="mc" onclick="clM(\'editPM\')">\u2715</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">URL del post de Facebook</label><div style="display:flex;gap:8px;"><input type="url" id="eUrl" class="fi" value="' + escH(post.url) + '" placeholder="https://www.facebook.com/..." style="flex:1"><button class="btn bg bs" onclick="doFetchMeta(\'eUrl\',\'ePrv\',\'eTitle\')" style="white-space:nowrap">\u{1F50D} Vista previa</button></div></div>' +
    '<div id="ePrv" class="iprv">' + (currentImg ? '<img src="' + escH(currentImg) + '" alt="Vista previa"><button class="ipl" onclick="clearFetchPreview(\'ePrv\')">\u2715 Quitar</button>' : '<div class="iph">\u{1F4F7} La imagen se obtendrá automáticamente del enlace</div>') + '</div>' +
    '<div class="fg"><label class="fl">Texto del post</label><textarea id="eText" class="fi" rows="4" placeholder="Copia el texto del post aquí">' + escH(post.postText || "") + '</textarea></div>' +
    '<div class="fg"><label class="fl">Fecha del post</label><input type="date" id="eDate" class="fi" value="' + escH(post.postDate || "") + '"></div>' +
    '<div class="fg"><label class="fl">Título / Página</label><input type="text" id="eTitle" class="fi" value="' + escH(post.pageTitle || "") + '" placeholder="Nombre de la página o título"></div>' +
    '<div class="fg"><label class="fl">Categoría</label><select id="eCat" class="fi"><option value="historico"' + (post.category === "historico" ? " selected" : "") + '>Histórico</option><option value="cultural"' + (post.category === "cultural" ? " selected" : "") + '>Cultural</option><option value="social"' + (post.category === "social" ? " selected" : "") + '>Social</option><option value="sin_clasificar"' + (post.category === "sin_clasificar" ? " selected" : "") + '>Sin Clasificar</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'editPM\')">Cancelar</button><button class="btn bp" id="eBtn" onclick="doEditPost(\'' + postId + '\')" style="width:auto">\u{1F4BE} Guardar Cambios</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doEditPost(postId) {
  var url = document.getElementById("eUrl").value.trim(),
    txt = document.getElementById("eText").value,
    dt = document.getElementById("eDate").value,
    ttl = document.getElementById("eTitle").value.trim(),
    cat = document.getElementById("eCat").value;
  var imgs = S.fetchedImage ? [S.fetchedImage] : [];
  if (!url) { toast("La URL es requerida", "error"); return; }
  var b = document.getElementById("eBtn"); b.disabled = true; b.textContent = "Guardando...";

  try {
    await db.collection("posts").doc(postId).update({
      url: url, postText: txt, postDate: dt, pageTitle: ttl, category: cat, images: imgs
    });
    toast("\u2705 Post actualizado", "success");
    clM("editPM"); S.fetchedImage = ""; S.editPostData = null;
    onPostUpdated(postId, url, txt, dt, ttl, cat, imgs);
  } catch (e) {
    toast("Error: " + e.message, "error");
    b.disabled = false; b.textContent = "\u{1F4BE} Guardar Cambios";
  }
}

// ============ DASHBOARD ============
function togDash() { S.showDash = !S.showDash; if (S.showDash) computeDash(); else renderApp(); }

function computeDash() {
  var posts = S.allPosts;
  var total = posts.length;
  var wImg = 0, cats = {}, months = {}, contribs = {};
  var days = [
    { d: "Domingo", c: 0 }, { d: "Lunes", c: 0 }, { d: "Martes", c: 0 },
    { d: "Miércoles", c: 0 }, { d: "Jueves", c: 0 }, { d: "Viernes", c: 0 }, { d: "Sábado", c: 0 }
  ];

  for (var i = 0; i < posts.length; i++) {
    var p = posts[i];
    if (p.images && p.images.length > 0) wImg++;
    cats[p.category] = (cats[p.category] || 0) + 1;
    var dt = new Date(p.createdAt);
    var mk = dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2);
    if (!months[mk]) months[mk] = { historico: 0, cultural: 0, social: 0, sin_clasificar: 0 };
    months[mk][p.category]++;
    days[dt.getDay()].c++;
    contribs[p.addedBy] = (contribs[p.addedBy] || 0) + 1;
  }

  var topC = Object.keys(contribs).map(function (n) { return { name: n, count: contribs[n] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
  var catArr = Object.keys(cats).map(function (k) { return { name: _catLabel(k), value: cats[k], color: _catColor(k) }; });
  var mArr = Object.keys(months).sort().slice(-12).map(function (m) { var x = months[m]; return { month: m, historico: x.historico, cultural: x.cultural, social: x.social, sin_clasificar: x.sin_clasificar }; });
  var uc = []; for (var i = 0; i < posts.length; i++) { if (uc.indexOf(posts[i].addedBy) === -1) uc.push(posts[i].addedBy); }

  var insights = null;
  if (total > 0) {
    insights = [];
    var sorted = Object.keys(cats).map(function (k) { return [k, cats[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    insights.push({ type: "info", title: "Categoría dominante", text: "\"" + _catLabel(sorted[0][0]) + "\" es el " + Math.round(sorted[0][1] / total * 100) + "% del contenido." });
    var best = days.reduce(function (m, d) { return d.c > m.c ? d : m; }, days[0]);
    var worst = days.reduce(function (m, d) { return d.c < m.c ? d : m; }, days[0]);
    insights.push({ type: "tip", title: "Día óptimo", text: best.d + " tiene más actividad (" + best.c + "). " + worst.d + " podría ser oportunidad." });
    var mks = Object.keys(months).sort();
    if (mks.length >= 2) {
      var lm = months[mks[mks.length - 1]], pm = months[mks[mks.length - 2]];
      var lt = lm.historico + lm.cultural + lm.social + lm.sin_clasificado;
      var pt = pm.historico + pm.cultural + pm.social + pm.sin_clasificado;
      var ch = pt > 0 ? Math.round((lt - pt) / pt * 100) : 0;
      insights.push({ type: ch >= 0 ? "success" : "warning", title: "Tendencia", text: ch >= 0 ? "📈 +" + ch + "% vs mes anterior" : "📉 " + ch + "% vs mes anterior" });
    }
  }

  S.dashData = {
    kpis: { total: total, wImg: wImg, uc: uc.length, cc: Object.keys(cats).filter(function (k) { return k !== "sin_clasificar"; }).length },
    cats: catArr, months: mArr, days: days, topC: topC, insights: insights
  };
  renderApp();
}

function rDash() {
  if (!S.dashData) return '<div class="do"><div class="dh"><h2>\u{1F4CA} Dashboard</h2><button class="hbn" onclick="togDash()">\u2715 Cerrar</button></div><div class="dc" style="display:flex;justify-content:center;padding:60px;"><div class="sp" style="width:40px;height:40px;"></div></div></div>';
  var d = S.dashData;
  var h = '<div class="do"><div class="dh"><h2>\u{1F4CA} Dashboard — Análisis de Contenido</h2><button class="hbn" onclick="togDash()">\u2715 Cerrar</button></div><div class="dc">';

  h += '<div class="kg"><div class="kc"><div class="kv">' + d.kpis.total + '</div><div class="kl">Total Publicaciones</div></div><div class="kc"><div class="kv">' + d.kpis.wImg + '</div><div class="kl">Con Imágenes</div></div><div class="kc"><div class="kv">' + d.kpis.uc + '</div><div class="kl">Contribuidores</div></div><div class="kc"><div class="kv">' + d.kpis.cc + '</div><div class="kl">Categorías Activas</div></div></div>';

  h += '<div class="cg">';
  h += '<div class="cc"><h4>\u{1F4CA} Distribución por Categoría</h4><div class="dnt"><div class="dn" style="background:conic-gradient(' + d.cats.map(function (c, i) { var off = d.cats.slice(0, i).reduce(function (s, x) { return s + x.value; }, 0); return c.color + ' ' + (off / d.kpis.total * 360) + 'deg ' + (off + c.value) / d.kpis.total * 360 + 'deg'; }).join(",") + ')"><div class="dnc"><div class="dnv">' + d.kpis.total + '</div><div class="dnl">Total</div></div></div><div class="dg">';
  for (var i = 0; i < d.cats.length; i++) { h += '<div class="li"><div class="ld" style="background:' + d.cats[i].color + '"></div>' + d.cats[i].name + '<span class="lv">' + d.cats[i].value + '</span></div>'; }
  h += '</div></div></div>';

  h += '<div class="cc"><h4>\u{1F4C5} Actividad por Día</h4>';
  var mx = Math.max.apply(null, d.days.map(function (x) { return x.c; })) || 1;
  for (var i = 0; i < d.days.length; i++) { h += '<div class="br"><div class="bl">' + d.days[i].d + '</div><div class="bt"><div class="bf" style="width:' + Math.round(d.days[i].c / mx * 100) + '%;background:' + (d.days[i].c === mx ? "var(--g)" : "var(--n)") + ';">' + d.days[i].c + '</div></div></div>'; }
  h += '</div></div>';

  h += '<div class="cg">';
  h += '<div class="cc"><h4>\u{1F4C8} Tendencia Mensual</h4>';
  if (d.months.length) {
    var mmx = 0; for (var i = 0; i < d.months.length; i++) { var t = d.months[i].historico + d.months[i].cultural + d.months[i].social + d.months[i].sin_clasificado; if (t > mmx) mmx = t; } mmx = mmx || 1;
    for (var i = 0; i < d.months.length; i++) { var t = d.months[i].historico + d.months[i].cultural + d.months[i].social + d.months[i].sin_clasificado; h += '<div class="br"><div class="bl">' + d.months[i].month + '</div><div class="bt"><div class="bf" style="width:' + Math.round(t / mmx * 100) + '%;background:var(--n);">' + t + '</div></div></div>'; }
  } else { h += '<p style="color:var(--m);font-size:13px;">Sin datos suficientes</p>'; }
  h += '</div>';

  h += '<div class="cc"><h4>\u{1F3C6} Top Contribuidores</h4>';
  for (var i = 0; i < d.topC.length; i++) { h += '<div class="br"><div class="bl">' + escH(d.topC[i].name) + '</div><div class="bt"><div class="bf" style="width:' + Math.round(d.topC[i].count / (d.topC[0].count || 1) * 100) + '%;background:var(--g);">' + d.topC[i].count + '</div></div></div>'; }
  h += '</div></div>';

  if (d.insights && d.insights.length) {
    h += '<h3 style="font-size:16px;font-weight:700;color:var(--n);margin-bottom:16px;">\u{1F4A1} Insights Estratégicos</h3><div class="ig">';
    for (var i = 0; i < d.insights.length; i++) { var ins = d.insights[i]; h += '<div class="ic2 ' + ins.type + '"><div class="it2">' + ins.title + '</div><div class="ix">' + ins.text + '</div></div>'; }
    h += '</div>';
  }
  h += '</div></div>';
  return h;
}

// ============ USERS ============
function togUsers() { S.showUsers = !S.showUsers; if (S.showUsers) loadU(); else renderApp(); }

async function loadU() {
  try {
    var snapshot = await db.collection("users").orderBy("createdAt", "desc").get();
    S.users = [];
    snapshot.forEach(function (doc) {
      var d = doc.data();
      S.users.push({ id: doc.id, username: d.username, name: d.name, role: d.role, active: d.active, createdAt: d.createdAt });
    });
    renderApp();
  } catch (e) {
    toast("Error: " + e.message, "error");
    S.showUsers = false;
    renderApp();
  }
}

function rUsers() {
  if (!S.users) return '<div class="uo"><div class="dh"><h2>\u{1F465} Gestión de Usuarios</h2><button class="hbn" onclick="togUsers()">\u2715 Cerrar</button></div><div class="dc" style="display:flex;justify-content:center;padding:60px;"><div class="sp" style="width:40px;height:40px;"></div></div></div>';
  var h = '<div class="uo"><div class="dh"><h2>\u{1F465} Gestión de Usuarios</h2><div style="display:flex;align-items:center;gap:16px;"><button class="btn bg bs" onclick="openAddU()">\u2795 Nuevo Usuario</button><button class="hbn" onclick="togUsers()">\u2715 Cerrar</button></div></div><div class="dc"><table class="ut"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>';
  for (var i = 0; i < S.users.length; i++) {
    var u = S.users[i];
    h += '<tr><td>' + escH(u.name) + '</td><td>' + escH(u.username) + '</td><td><span class="rb ' + _roleBadgeCls(u.role) + '">' + _roleIcon(u.role) + ' ' + _roleLabel(u.role) + '</span></td><td class="' + (u.active ? "sa" : "si2") + '">' + (u.active ? "\u2705 Activo" : "\u274C Inactivo") + '</td><td><button class="btn bo bs" onclick="openEditU(\'' + u.id + '\')">\u270F\uFE0F</button> <button class="btn bw bs" onclick="openResetPwU(\'' + u.id + '\')">\u{1F511}</button> ' + (u.username !== "admin" ? '<button class="btn bd bs" onclick="togAct(\'' + u.id + '\',' + !u.active + ')">' + (u.active ? "Desactivar" : "Activar") + '</button> <button class="btn bd bs" onclick="delU(\'' + u.id + '\')">\u{1F5D1}</button>' : "") + '</td></tr>';
  }
  h += '</tbody></table></div></div>';
  return h;
}

function openAddU() {
  var d = document.createElement("div"); d.id = "addUM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>\u2795 Nuevo Usuario</h3><button class="mc" onclick="clM(\'addUM\')">\u2715</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">Nombre completo</label><input type="text" id="nuName" class="fi" placeholder="Ej: Juan Pérez"></div>' +
    '<div class="fg"><label class="fl">Usuario</label><input type="text" id="nuUser" class="fi" placeholder="Ej: juan.perez"></div>' +
    '<div class="fg"><label class="fl">Contraseña</label><div class="pw"><input type="password" id="nuPass" class="fi" placeholder="Mínimo 6 caracteres"><button type="button" class="pt" onclick="togglePw(\'nuPass\',this)">\u{1F441}</button></div></div>' +
    '<div class="fg"><label class="fl">Rol</label><select id="nuRole" class="fi"><option value="viewer">\u{1F441} Visualizador</option><option value="gestionador">\u270F\uFE0F Gestionador</option><option value="admin">\u{1F6E1} Administrador</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'addUM\')">Cancelar</button><button class="btn bp" id="nuBtn" onclick="doAddU()" style="width:auto">\u{1F4BE} Crear</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doAddU() {
  var n = document.getElementById("nuName").value.trim(),
    u = document.getElementById("nuUser").value.trim().toLowerCase(),
    p = document.getElementById("nuPass").value,
    r = document.getElementById("nuRole").value;

  if (!n || !u || !p) { toast("Todos los campos son requeridos", "error"); return; }
  if (p.length < 6) { toast("Contraseña: mínimo 6 caracteres", "error"); return; }
  var b = document.getElementById("nuBtn"); b.disabled = true;

  try {
    // Verificar que no exista el username
    var existing = await db.collection("users").where("username", "==", u).limit(1).get();
    if (!existing.empty) { toast("Usuario ya existe", "error"); b.disabled = false; return; }

    // Crear usuario en Firebase Auth usando instancia secundaria
    var email = _usernameToEmail(u);
    var secondaryApp = firebase.initializeApp(firebase.app().options, "Secondary" + Date.now());
    var cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, p);
    var newUid = cred.user.uid;

    // Crear documento en Firestore
    await db.collection("users").doc(newUid).set({
      username: u, name: n, role: r, active: true,
      createdAt: new Date().toISOString(), uid: newUid
    });

    // Cerrar sesión en instancia secundaria
    await secondaryApp.auth().signOut();
    // Eliminar la app secundaria
    secondaryApp.delete().catch(function () { });

    toast("\u2705 Usuario creado", "success");
    clM("addUM");
    loadU();
  } catch (e) {
    var msg = e.message;
    if (e.code === "auth/email-already-in-use") msg = "Usuario ya existe";
    toast("Error: " + msg, "error");
    b.disabled = false;
  }
}

function openEditU(uid) {
  var u = S.users.find(function (x) { return x.id === uid; }); if (!u) return;
  var d = document.createElement("div"); d.id = "editUM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>\u270F\uFE0F Editar Usuario</h3><button class="mc" onclick="clM(\'editUM\')">\u2715</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">Nombre</label><input type="text" id="euName" class="fi" value="' + escH(u.name) + '"></div>' +
    '<div class="fg"><label class="fl">Nueva contraseña (vacío = no cambiar)</label><div class="pw"><input type="password" id="euPass" class="fi" placeholder="Nueva contraseña"><button type="button" class="pt" onclick="togglePw(\'euPass\',this)">\u{1F441}</button></div></div>' +
    '<div class="fg"><label class="fl">Rol</label><select id="euRole" class="fi"><option value="viewer"' + (u.role === "viewer" ? " selected" : "") + '>\u{1F441} Visualizador</option><option value="gestionador"' + (u.role === "gestionador" ? " selected" : "") + '>\u270F\uFE0F Gestionador</option><option value="admin"' + (u.role === "admin" ? " selected" : "") + '>\u{1F6E1} Administrador</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'editUM\')">Cancelar</button><button class="btn bp" onclick="doEditU(\'' + uid + '\')" style="width:auto">\u{1F4BE} Guardar</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doEditU(uid) {
  var n = document.getElementById("euName").value.trim(),
    p = document.getElementById("euPass").value,
    r = document.getElementById("euRole").value;
  var ud = { name: n, role: r };
  if (p) { if (p.length < 6) { toast("Contraseña: mínimo 6 caracteres", "error"); return; } }

  try {
    await db.collection("users").doc(uid).update({ name: n, role: r });

    // Si hay nueva contraseña, actualizar en Firebase Auth
    if (p) {
      // Nota: Cambiar contraseña de otro usuario requiere Admin SDK (server-side)
      // Por ahora, actualizamos solo Firestore. Para contraseña, se necesitaría Cloud Function.
      toast("\u2705 Usuario actualizado (contraseña no cambiada - requiere función server)", "info");
    } else {
      toast("\u2705 Usuario actualizado", "success");
    }
    clM("editUM"); loadU();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function togAct(uid, act) {
  try {
    await db.collection("users").doc(uid).update({ active: act });
    toast(act ? "\u2705 Activado" : "\u{1F534} Desactivado", "success");
    loadU();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function delU(uid) {
  if (!confirm("¿Eliminar este usuario?")) return;
  try {
    await db.collection("users").doc(uid).delete();
    toast("\u2705 Eliminado", "success");
    loadU();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

// ============ SETTINGS ============
function togSettings() { S.showSettings = !S.showSettings; if (S.showSettings) loadSettings(); else renderApp(); }

async function loadSettings() {
  try {
    var cfgDoc = await db.collection("config").doc("app").get();
    if (cfgDoc.exists) {
      S.settingsData = cfgDoc.data();
      if (cfgDoc.data().logoUrl !== undefined) { S.logoUrl = cfgDoc.data().logoUrl; localStorage.setItem("rt_lu", cfgDoc.data().logoUrl); }
    } else {
      S.settingsData = { logoUrl: "" };
    }
    renderApp();
  } catch (e) {
    toast("Error: " + e.message, "error");
    S.showSettings = false;
    renderApp();
  }
}

function rSettings() {
  var sd = S.settingsData || { logoUrl: S.logoUrl };
  var curLogo = sd.logoUrl || S.logoUrl || "";
  var h = '<div class="so"><div class="dh"><h2>\u2699\uFE0F Configuración</h2><button class="hbn" onclick="togSettings()">\u2715 Cerrar</button></div><div class="sc">';

  h += '<div class="slg"><h4>\u{1F3A8} Logo de la Aplicación</h4><p>Ingresa la URL de tu logo para reemplazar la letra "R". Se recomienda una imagen cuadrada (PNG con fondo transparente funciona mejor).</p>';
  h += '<div class="sprv"><div>' + (curLogo ? '<div class="lo"><img src="' + escH(curLogo) + '" alt="Logo"></div>' : logoHTML("lo", "lg")) + '</div><div>' + (curLogo ? '<div class="hl"><img src="' + escH(curLogo) + '" alt="Logo"></div>' : logoHTML("hl", "md")) + '</div><div>' + (curLogo ? '<div class="fl2"><img src="' + escH(curLogo) + '" alt="Logo"></div>' : logoHTML("fl2", "sm")) + '</div><div><div class="sprv-label">Vista previa: Login | Header | Footer</div></div></div>';
  h += '<div class="fg"><label class="fl">URL del Logo</label><input type="url" id="sLogoUrl" class="fi" value="' + escH(curLogo) + '" placeholder="https://ejemplo.com/mi-logo.png"></div>';
  h += '<div style="display:flex;gap:10px;"><button class="btn bp" onclick="saveLogo()" style="width:auto;flex:1">\u{1F4BE} Guardar Logo</button>' + (curLogo ? '<button class="btn bd" onclick="removeLogo()" style="width:auto">\u{1F5D1} Quitar Logo</button>' : '') + '</div>';
  h += '<div style="margin-top:12px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;"><strong>\u{1F4A1} Tip:</strong> Puedes subir tu logo a <a href="https://imgur.com/upload" target="_blank" style="color:var(--n);font-weight:600;">Imgur</a> o <a href="https://drive.google.com" target="_blank" style="color:var(--n);font-weight:600;">Google Drive</a> y pegar el enlace directo aquí.<br><br>Para Google Drive usa el formato:<br><code style="font-size:11px;background:#fef3c7;padding:2px 6px;border-radius:4px;">https://drive.google.com/uc?export=view&id=FILE_ID</code></div>';
  h += '</div>';

  h += '<div class="slg"><h4>\u{1F4CB} Información del Sistema</h4><div style="font-size:13px;color:var(--m);line-height:1.8;">';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Aplicación</span><strong style="color:var(--n)">RULETERO 222</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Plataforma</span><strong style="color:var(--n)">GitHub Pages + Firebase</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Versión</span><strong style="color:var(--n)">6.0</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>Estado del Logo</span><strong style="color:' + (curLogo ? "#22c55e" : "#ef4444") + '">' + (curLogo ? "Configurado" : "Sin configurar (letra R)") + '</strong></div>';
  h += '</div></div>';
  h += '</div></div>';
  return h;
}

async function saveLogo() {
  var url = document.getElementById("sLogoUrl").value.trim();
  try {
    await db.collection("config").doc("app").set({ logoUrl: url }, { merge: true });
    S.logoUrl = url; localStorage.setItem("rt_lu", url);
    toast("\u2705 Logo guardado correctamente", "success");
    renderApp();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function removeLogo() {
  if (!confirm("¿Quitar el logo y volver a la letra R?")) return;
  try {
    await db.collection("config").doc("app").set({ logoUrl: "" }, { merge: true });
    S.logoUrl = ""; localStorage.setItem("rt_lu", "");
    toast("\u2705 Logo eliminado", "success");
    renderApp();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

// ============ RENDER APP PRINCIPAL ============
function renderApp() {
  if (!S.user) { renderLogin(); return; }
  var ad = S.user && S.user.role === "admin",
    gst = S.user && S.user.role === "gestionador",
    canAdd = ad || gst,
    a = document.getElementById("app");

  a.innerHTML = (S.showDash ? rDash() : "") + (S.showUsers ? rUsers() : "") + (S.showSettings ? rSettings() : "") +
    '<header class="hd"><div class="hi"><div class="hb">' + logoHTML("hl", "md") + '<div><div class="ht">RULETERO 222</div><div class="hs">La Ruta de los Poblanos</div></div></div><div class="ha">' +
    '<button class="hbn" onclick="togDash()">\u{1F4CA} <span>Dashboard</span></button>' +
    (ad ? '<button class="hbn gold" onclick="togUsers()">\u{1F465} <span>Usuarios</span></button><button class="hbn" onclick="togSettings()">\u2699\uFE0F <span>Config</span></button>' : '') +
    '<div class="ui"><div class="uv ' + _roleUVCls(S.user.role) + '">' + _roleIcon(S.user.role) + '</div><div><div style="font-size:12px;font-weight:600">' + escH(S.user.name) + '</div><div style="font-size:10px;color:rgba(255,255,255,.5)">' + _roleLabel(S.user.role) + '</div></div></div>' +
    '<button class="hbn" onclick="openChangeMyPw()">\u{1F511} <span>Contraseña</span></button>' +
    '<button class="hbn" onclick="doLogout()">\u{1F6AA} <span>Salir</span></button></div></div><div class="hgl"></div></header>' +
    '<main class="mn">' +
    (canAdd ? '<button class="btn bg" onclick="openAdd()" style="margin-bottom:16px;">\u2795 Agregar Post</button>' : '<div class="vn">\u{1F441} Modo visualizador — Solo puedes ver el contenido.</div>') +
    '<div class="tb"><div><div class="tt">Publicaciones Guardadas</div><div class="tc">' + S.total + ' publicaciones</div></div><div class="ta">' +
    '<div class="sb"><span class="si">\u{1F50D}</span><input type="text" placeholder="Buscar..." value="' + escH(S.search) + '" oninput="doSearch(this.value)"></div>' +
    '<select id="yFilter" class="fi" style="padding:10px 12px;border:2px solid var(--bd);border-radius:10px;font-size:13px;width:auto;min-width:130px;outline:none;cursor:pointer;background:var(--cb)" onchange="doYearFilter(this.value)"><option value="todos">Todos los años</option></select>' +
    '<div class="vt"><button class="vb ' + (S.view === "grid" ? "ac" : "") + '" onclick="setV(\'grid\')">\u25A6</button><button class="vb ' + (S.view === "list" ? "ac" : "") + '" onclick="setV(\'list\')">\u2630</button></div></div></div>' +
    '<div id="pC"></div><div id="pgC"></div></main>' +
    '<footer class="ft"><div class="fgl"></div><div class="fi2"><div class="fb">' + logoHTML("fl2", "sm") + '<span style="font-size:13px;font-weight:700;">RULETERO 222</span><span style="color:var(--g);font-size:11px;">|</span><span style="font-size:11px;color:rgba(255,255,255,.6);">La Ruta de los Poblanos</span></div><div class="fc">\u00a9 ' + new Date().getFullYear() + ' Gestor de Posts</div></div></footer>';

  if (!S.loading) renderPosts();
}

// ============ CHANGE MY PASSWORD ============
function openChangeMyPw() {
  var d = document.createElement("div"); d.id = "chPwM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>\u{1F511} Cambiar Mi Contraseña</h3><button class="mc" onclick="clM(\'chPwM\')">\u2715</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">Contraseña actual</label><div class="pw"><input type="password" id="cpCur" class="fi" placeholder="Tu contraseña actual"><button type="button" class="pt" onclick="togglePw(\'cpCur\',this)">\u{1F441}</button></div></div>' +
    '<div class="fg"><label class="fl">Nueva contraseña</label><div class="pw"><input type="password" id="cpNew" class="fi" placeholder="Mínimo 6 caracteres"><button type="button" class="pt" onclick="togglePw(\'cpNew\',this)">\u{1F441}</button></div></div>' +
    '<div class="fg"><label class="fl">Confirmar nueva contraseña</label><div class="pw"><input type="password" id="cpConf" class="fi" placeholder="Repite la nueva contraseña"><button type="button" class="pt" onclick="togglePw(\'cpConf\',this)">\u{1F441}</button></div></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'chPwM\')">Cancelar</button><button class="btn bp" id="cpBtn" onclick="doChangeMyPw()" style="width:auto">\u{1F4BE} Cambiar</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doChangeMyPw() {
  var cur = document.getElementById("cpCur").value,
    nw = document.getElementById("cpNew").value,
    conf = document.getElementById("cpConf").value,
    b = document.getElementById("cpBtn");

  if (!cur || !nw || !conf) { toast("Completa todos los campos", "error"); return; }
  if (nw.length < 6) { toast("La nueva contraseña debe tener mínimo 6 caracteres", "error"); return; }
  if (nw !== conf) { toast("Las contraseñas nuevas no coinciden", "error"); return; }
  if (cur === nw) { toast("La nueva contraseña debe ser diferente", "error"); return; }

  b.disabled = true; b.textContent = "Cambiando...";

  try {
    var user = auth.currentUser;
    if (!user) { toast("No hay sesión activa", "error"); b.disabled = false; b.textContent = "\u{1F4BE} Cambiar"; return; }

    // Re-autenticar al usuario con su contraseña actual
    var credential = firebase.auth.EmailAuthProvider.credential(user.email, cur);
    await user.reauthenticateWithCredential(credential);

    // Cambiar la contraseña
    await user.updatePassword(nw);

    toast("\u2705 Contraseña cambiada correctamente", "success");
    clM("chPwM");
  } catch (e) {
    var msg = "Error al cambiar la contraseña";
    if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") msg = "La contraseña actual es incorrecta";
    else if (e.code === "auth/too-many-requests") msg = "Demasiados intentos. Espera un momento";
    else if (e.code === "auth/requires-recent-login") msg = "Tu sesión expiró. Cierra sesión e inicia de nuevo";
    else if (e.message) msg = e.message;
    toast(msg, "error");
    b.disabled = false; b.textContent = "\u{1F4BE} Cambiar";
  }
}

// ============ RESET PASSWORD (ADMIN) ============
function openResetPwU(uid) {
  var u = S.users.find(function (x) { return x.id === uid; }); if (!u) return;
  var d = document.createElement("div"); d.id = "resetPwM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>\u{1F511} Restablecer Contraseña</h3><button class="mc" onclick="clM(\'resetPwM\')">\u2715</button></div>' +
    '<div class="mb">' +
    '<p style="font-size:14px;color:var(--t);margin-bottom:16px;">Restablecer contraseña de <strong>' + escH(u.name) + '</strong> (<code>' + escH(u.username) + '</code>)</p>' +
    '<div class="fg"><label class="fl">Nueva contraseña</label><div class="pw"><input type="password" id="rpNew" class="fi" placeholder="Mínimo 6 caracteres"><button type="button" class="pt" onclick="togglePw(\'rpNew\',this)">\u{1F441}</button></div></div>' +
    '<div class="fg"><label class="fl">Confirmar nueva contraseña</label><div class="pw"><input type="password" id="rpConf" class="fi" placeholder="Repite la nueva contraseña"><button type="button" class="pt" onclick="togglePw(\'rpConf\',this)">\u{1F441}</button></div></div>' +
    '<div style="margin-top:12px;padding:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;line-height:1.5;"><strong>\u{1F4A1} Nota:</strong> Al cambiar la contraseña, el usuario deberá iniciar sesión nuevamente con su nueva contraseña.</div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'resetPwM\')">Cancelar</button><button class="btn bp" id="rpBtn" onclick="doResetPwU(\'' + uid + '\')" style="width:auto">\u{1F4BE} Restablecer</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doResetPwU(uid) {
  var nw = document.getElementById("rpNew").value,
    conf = document.getElementById("rpConf").value,
    b = document.getElementById("rpBtn");

  if (!nw || !conf) { toast("Completa todos los campos", "error"); return; }
  if (nw.length < 6) { toast("La nueva contraseña debe tener mínimo 6 caracteres", "error"); return; }
  if (nw !== conf) { toast("Las contraseñas no coinciden", "error"); return; }

  b.disabled = true; b.textContent = "Cambiando...";

  try {
    var userData = S.users.find(function (x) { return x.id === uid; });
    if (!userData) { toast("Usuario no encontrado", "error"); b.disabled = false; b.textContent = "\u{1F4BE} Restablecer"; return; }

    // No se puede cambiar la contraseña de otro usuario desde el cliente sin Admin SDK.
    // Mostramos instrucciones claras para hacerlo desde Firebase Console.
    clM("resetPwM");

    // Mostrar guía paso a paso
    var guide = document.createElement("div"); guide.id = "resetGuide"; guide.className = "mo";
    guide.innerHTML = '<div class="md"><div class="mh"><h3>\u{1F511} Cómo cambiar la contraseña</h3><button class="mc" onclick="clM(\'resetGuide\')">\u2715</button></div>' +
      '<div class="mb">' +
      '<p style="font-size:14px;margin-bottom:16px;">Para cambiar la contraseña de <strong>' + escH(userData.name) + '</strong>, sigue estos pasos:</p>' +
      '<div style="background:#f1f5f9;border-radius:10px;padding:16px;margin-bottom:16px;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="background:var(--n);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">1</span><span style="font-size:13px;">Abre <a href="https://console.firebase.google.com/" target="_blank" style="color:var(--n);font-weight:600;">Firebase Console</a></span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="background:var(--n);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">2</span><span style="font-size:13px;">Ve a <strong>Authentication</strong> \u2192 <strong>Users</strong></span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="background:var(--n);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">3</span><span style="font-size:13px;">Busca el usuario <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;">' + escH(userData.username) + '@ruletero222.app</code></span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span style="background:var(--n);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">4</span><span style="font-size:13px;">Haz clic en los <strong>tres puntos</strong> \u22EE \u2192 <strong>Cambiar contraseña</strong></span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;"><span style="background:var(--g);color:var(--n);width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">5</span><span style="font-size:13px;">Escribe la nueva contraseña y guarda</span></div>' +
      '</div>' +
      '<div style="padding:12px;background:#dcfce7;border:1px solid #86efac;border-radius:8px;font-size:12px;color:#166534;"><strong>\u2705 Hecho:</strong> El usuario podrá iniciar sesión con la nueva contraseña inmediatamente.</div>' +
      '</div><div class="mf"><button class="btn bp" onclick="clM(\'resetGuide\')" style="width:auto">Entendido</button></div></div>';
    document.body.appendChild(guide); setTimeout(function () { guide.classList.add("ac"); }, 50);
    b.disabled = false; b.textContent = "\u{1F4BE} Restablecer";

  } catch (e) {
    toast("Error: " + e.message, "error");
    b.disabled = false; b.textContent = "\u{1F4BE} Restablecer";
  }
}

// ============ UTILS ============
function clM(id) { var d = document.getElementById(id); if (d) { d.classList.remove("ac"); setTimeout(function () { d.remove(); }, 300); } }

// ============ INICIALIZACIÓN DEL SISTEMA ============
async function setupInitialAdmin() {
  /**
   * EJECUTA ESTA FUNCIÓN UNA SOLA VEZ desde la consola del navegador
   * para crear el usuario administrador inicial.
   * 
   * Uso: setupInitialAdmin()
   */
  try {
    // Verificar si ya existe el admin
    var existing = await db.collection("users").where("username", "==", "admin").limit(1).get();
    if (!existing.empty) {
      toast("El usuario admin ya existe", "info");
      return;
    }

    // Crear en Firebase Auth
    var email = _usernameToEmail("admin");
    var cred = await auth.createUserWithEmailAndPassword(email, "admin123");
    var uid = cred.user.uid;

    // Crear documento en Firestore
    await db.collection("users").doc(uid).set({
      username: "admin",
      name: "Administrador",
      role: "admin",
      active: true,
      createdAt: new Date().toISOString(),
      uid: uid
    });

    // Crear documento de configuración
    await db.collection("config").doc("app").set({ logoUrl: "" }, { merge: true });

    // Cerrar sesión del admin recién creado
    await auth.signOut();

    toast("✅ Admin creado. Usuario: admin | Contraseña: admin123", "success");
    toast("⚠️ Cambia la contraseña después de iniciar sesión", "info");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
}

// ============ START ============
// La inicialización se hace cuando se carga firebase-config.js
// init() se llama al final de index.html
