/**
 * RULETERO 222 - Aplicación Principal
 * Versión GitHub Pages + Firebase
 * 
 * Migrado de Google Apps Script a Firebase Firestore + Auth
 * 
 * v7.0 — Agregado: Firebase Storage, Realtime, Auditoría, CSV, Modo Oscuro
 */

// ============ ESTADO GLOBAL ============
var S = {
  user: null,
  posts: [],
  allPosts: [],
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
  unsubPosts: null,
  darkMode: false,
  uploadedFile: null,
  uploadedUrl: ""
};

// ============ CONSTANTES ============
var POSTS_PER_PAGE = 12;

// ============ HELPERS ============
function logoHTML(cls, size) {
  if (S.logoUrl) {
    var bg = S.darkMode ? '#1e293b' : '#fff';
    return '<div class="' + cls + '" style="background:' + bg + ';display:flex;align-items:center;justify-content:center;"><img src="' + escH(S.logoUrl) + '" alt="RULETERO 222"></div>';
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

// ============ DARK MODE ============
function _initDarkMode() {
  var saved = localStorage.getItem("rt_dm");
  if (saved === "true") {
    S.darkMode = true;
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (saved === null && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    S.darkMode = true;
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

function _toggleDarkMode() {
  S.darkMode = !S.darkMode;
  document.documentElement.setAttribute("data-theme", S.darkMode ? "dark" : "light");
  localStorage.setItem("rt_dm", S.darkMode ? "true" : "false");
  toast(S.darkMode ? "Modo oscuro activado" : "Modo claro activado", "info");
}

// ============ AUDIT LOG ============
async function _audit(action, details) {
  if (!S.user) return;
  try {
    await db.collection("audit").add({
      action: action,
      details: details || "",
      userId: S.user.uid || S.user.id,
      userName: S.user.name,
      userEmail: S.user.email,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error("Error writing audit:", e);
  }
}

// ============ FIRESTORE HELPERS ============
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
      } catch (e) { continue; }
    }
    if (!html) return { ok: true, meta: meta };
    var ogImgMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (!ogImgMatch) ogImgMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImgMatch) meta.image = _htmlDecode(ogImgMatch[1]);
    var ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (!ogTitleMatch) ogTitleMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogTitleMatch) meta.title = _htmlDecode(ogTitleMatch[1]);
    var ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    if (!ogDescMatch) ogDescMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    if (ogDescMatch) meta.description = _htmlDecode(ogDescMatch[1]);
    if (!meta.image) {
      var twImgMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
      if (!twImgMatch) twImgMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
      if (twImgMatch) meta.image = _htmlDecode(twImgMatch[1]);
    }
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

// ============ IMAGE UPLOAD (Firebase Storage) ============
function _renderUploadArea(id, currentImg) {
  var hasImg = currentImg ? true : false;
  var h = '<div class="iupload" onclick="document.getElementById(\'' + id + '\').click()">';
  h += '<input type="file" id="' + id + '" accept="image/*" onchange="_handleFileSelect(\'' + id + '\', this)">';
  if (hasImg) {
    h += '<div class="iupload-preview"><img src="' + escH(currentImg) + '" alt="Imagen">';
    h += '<button class="iupload-remove" onclick="event.stopPropagation(); _removeUpload(\'' + id + '\')">Quitar</button></div>';
  } else {
    h += '<div class="iupload-icon">📷</div>';
    h += '<div class="iupload-text">Haz clic para subir una imagen</div>';
    h += '<div class="iupload-hint">JPG, PNG, WEBP — Máximo 5 MB</div>';
  }
  h += '<div id="' + id + '-progress" class="iupload-progress" style="display:none"><div id="' + id + '-bar" class="iupload-progress-bar" style="width:0%"></div></div>';
  h += '</div>';
  return h;
}

function _handleFileSelect(inputId, input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast("La imagen no debe superar 5 MB", "error");
    input.value = "";
    return;
  }
  if (!file.type.startsWith("image/")) {
    toast("Solo se permiten imágenes", "error");
    input.value = "";
    return;
  }
  S.uploadedFile = file;
  S.uploadedUrl = "";
  // Show preview
  var reader = new FileReader();
  reader.onload = function (e) {
    var container = input.closest(".iupload");
    if (container) {
      container.innerHTML = '<input type="file" id="' + inputId + '" accept="image/*" onchange="_handleFileSelect(\'' + inputId + '\', this)" style="display:none">';
      container.innerHTML += '<div class="iupload-preview"><img src="' + e.target.result + '" alt="Preview">';
      container.innerHTML += '<button class="iupload-remove" onclick="event.stopPropagation(); _removeUpload(\'' + inputId + '\')">Quitar</button></div>';
      container.innerHTML += '<div id="' + inputId + '-progress" class="iupload-progress" style="display:none"><div id="' + inputId + '-bar" class="iupload-progress-bar" style="width:0%"></div></div>';
    }
  };
  reader.readAsDataURL(file);
}

function _removeUpload(inputId) {
  S.uploadedFile = null;
  S.uploadedUrl = "";
  var container = document.getElementById(inputId);
  if (container) container.closest(".iupload").querySelector("input").value = "";
  // Reset upload area
  var uploadDiv = container ? container.closest(".iupload") : null;
  if (uploadDiv) {
    uploadDiv.innerHTML = '<input type="file" id="' + inputId + '" accept="image/*" onchange="_handleFileSelect(\'' + inputId + '\', this)" style="display:none">';
    uploadDiv.innerHTML += '<div class="iupload-icon">📷</div>';
    uploadDiv.innerHTML += '<div class="iupload-text">Haz clic para subir una imagen</div>';
    uploadDiv.innerHTML += '<div class="iupload-hint">JPG, PNG, WEBP — Máximo 5 MB</div>';
    uploadDiv.innerHTML += '<div id="' + inputId + '-progress" class="iupload-progress" style="display:none"><div id="' + inputId + '-bar" class="iupload-progress-bar" style="width:0%"></div></div>';
  }
  S.fetchedImage = "";
}

async function _uploadImageToStorage(file, postId) {
  if (!file) return null;
  try {
    var fileName = "posts/" + (postId || Date.now()) + "/" + Date.now() + "_" + file.name;
    var ref = storage.ref(fileName);
    var uploadTask = ref.put(file);

    return new Promise(function (resolve, reject) {
      uploadTask.on("state_changed",
        function (snapshot) {
          var progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          var bar = document.getElementById("aFile-bar") || document.getElementById("eFile-bar");
          var prog = document.getElementById("aFile-progress") || document.getElementById("eFile-progress");
          if (bar) bar.style.width = progress + "%";
          if (prog) prog.style.display = "block";
        },
        function (error) {
          console.error("Upload error:", error);
          reject(error);
        },
        function () {
          uploadTask.snapshot.ref.getDownloadURL().then(function (url) {
            resolve(url);
          }).catch(reject);
        }
      );
    });
  } catch (e) {
    console.error("Storage error:", e);
    return null;
  }
}

// ============ AUTH ============
function clearS() {
  localStorage.removeItem("rt_tk");
  localStorage.removeItem("rt_u");
  localStorage.removeItem("rt_lu");
  S.user = null; S.token = null; S.logoUrl = "";
  _stopPostsListener();
}

function renderLogin() {
  var a = document.getElementById("app");
  a.innerHTML = '<div class="lc"><div class="lk">' + logoHTML("lo", "lg") +
    '<h1 class="lt">RULETERO 222</h1><p class="ls">La Ruta de los Poblanos</p>' +
    '<div id="lErr" class="lerr"></div>' +
    '<div class="fg"><label class="fl">Correo electrónico</label><input type="email" id="lUser" class="fi" placeholder="tu@correo.com" autocomplete="email"></div>' +
    '<div class="fg"><label class="fl">Contraseña</label><div class="pw"><input type="password" id="lPass" class="fi" placeholder="Ingresa tu contraseña" autocomplete="current-password"><button type="button" class="pt" onclick="togglePw(\'lPass\',this)" title="Mostrar/ocultar">👁</button></div></div>' +
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
    er.textContent = "Ingresa correo y contraseña";
    er.className = "lerr show";
    return;
  }

  if (u.indexOf("@") === -1) {
    er.textContent = "Ingresa tu correo electrónico (ej: tu@correo.com)";
    er.className = "lerr show";
    return;
  }

  b.disabled = true;
  txt.innerHTML = '<span class="sp spw" style="width:16px;height:16px;border-width:2px;"></span> Verificando...';
  er.className = "lerr";

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
    var email = u.toLowerCase();
    var cred = await auth.signInWithEmailAndPassword(email, p);
    var firebaseUser = cred.user;

    var userDoc = await db.collection("users").doc(firebaseUser.uid).get();
    if (!userDoc.exists) {
      var userQuery = await db.collection("users").where("email", "==", email).limit(1).get();
      if (!userQuery.empty) userDoc = userQuery.docs[0];
    }

    if (!userDoc.exists) {
      await auth.signOut();
      if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
      er.textContent = "Tu cuenta no está registrada en el sistema. Contacta al administrador.";
      er.className = "lerr show";
      b.disabled = false;
      txt.textContent = "Iniciar Sesión";
      return;
    }

    var userData = userDoc.data();
    if (!userData.active) {
      await auth.signOut();
      if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
      er.textContent = "Tu cuenta está desactivada. Contacta al administrador.";
      er.className = "lerr show";
      b.disabled = false;
      txt.textContent = "Iniciar Sesión";
      return;
    }

    S.user = {
      id: userDoc.id,
      uid: firebaseUser.uid,
      email: userData.email || email,
      username: userData.email || email,
      name: userData.name,
      role: userData.role
    };
    S.token = await firebaseUser.getIdToken();

    localStorage.setItem("rt_tk", S.token);
    localStorage.setItem("rt_u", JSON.stringify(S.user));

    await _loadInitialData();

    if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
    renderApp();
    renderPosts();
    renderPag();

    _audit("login", "Inicio de sesión");

  } catch (e) {
    if (S.loginTimeout) { clearTimeout(S.loginTimeout); S.loginTimeout = null; }
    var msg = "Error de conexión";
    if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
      msg = "Correo o contraseña incorrectos";
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
    var cfgDoc = await db.collection("config").doc("app").get();
    if (cfgDoc.exists && cfgDoc.data().logoUrl) {
      S.logoUrl = cfgDoc.data().logoUrl;
      localStorage.setItem("rt_lu", S.logoUrl);
    }
    _startPostsListener();
    S.loading = false;
  } catch (e) {
    console.error("Error cargando datos iniciales:", e);
    S.loading = false;
  }
}

function doLogout() {
  _audit("logout", "Cierre de sesión");
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
  _initDarkMode();
  var lu = localStorage.getItem("rt_lu");
  if (lu) S.logoUrl = lu;

  _fetchLogo();

  auth.onAuthStateChanged(function (firebaseUser) {
    if (firebaseUser) {
      var a = document.getElementById("app");
      a.innerHTML = '<div class="lss"><div style="text-align:center"><div class="sp" style="width:40px;height:40px;margin:0 auto 16px"></div><div style="color:#64748b;font-size:14px">Verificando sesión...</div><div style="margin-top:12px"><a href="#" onclick="forceShowLogin();return false;" style="color:#94a3b8;font-size:12px">Iniciar sesión manualmente</a></div></div></div>';
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
      var userDoc = await db.collection("users").doc(parsed.id).get();
      if (userDoc.exists) {
        var ud = userDoc.data();
        if (ud.active) {
          S.user = {
            id: userDoc.id,
            uid: firebaseUser.uid,
            email: ud.email,
            username: ud.email,
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

// ============ POSTS - REALTIME LISTENER ============
function _startPostsListener() {
  _stopPostsListener();
  S.unsubPosts = db.collection("posts").orderBy("createdAt", "desc")
    .onSnapshot(function (snapshot) {
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
      renderPosts();
      renderPag();
      updateCounter();
      loadYears();
    }, function (err) {
      console.error("Error en listener de posts:", err);
      toast("Error en actualizaciones en tiempo real", "error");
    });
}

function _stopPostsListener() {
  if (S.unsubPosts) {
    S.unsubPosts();
    S.unsubPosts = null;
  }
}

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
  if (S.yearFilter && S.yearFilter !== "todos") {
    filtered = filtered.filter(function (p) {
      var d = p.postDate || p.createdAt || "";
      return d.substring(0, 4) === S.yearFilter;
    });
  }
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

// ===== OPTIMISTIC UPDATES =====
function onPostAdded(r, url, txt, dt, ttl, imgs, selCat) {
  // No longer needed with realtime — the listener will handle it
}

function onPostUpdated(postId, url, txt, dt, ttl, cat, imgs) {
  // No longer needed with realtime — the listener will handle it
}

function onPostDeleted(id) {
  // No longer needed with realtime — the listener will handle it
}

// ============ POSTS CRUD ============
function catBadge(c) {
  var m = { historico: ["Histórico", "bh"], cultural: ["Cultural", "bc"], social: ["Social", "bs2"], sin_clasificar: ["Sin Clasificar", "bx"] };
  var v = m[c] || m.sin_clasificar;
  return '<span class="cb ' + v[1] + '">' + v[0] + '</span>';
}

function postButtons(p, ad, canEdit) {
  if (!canEdit && !ad) return '<div class="pa"><a href="' + escH(p.url) + '" target="_blank" class="btn bo bs">🔗 Abrir</a></div>';
  var h = '<div class="pa"><a href="' + escH(p.url) + '" target="_blank" class="btn bo bs">🔗 Abrir</a>';
  if (canEdit) h += '<button class="btn bw bs" onclick="openEditPost(\'' + p.id + '\')">✏️ Editar</button>';
  if (ad) h += '<button class="btn bd bs" onclick="delPost(\'' + p.id + '\')">🗑 Eliminar</button>';
  h += '</div>';
  return h;
}

async function delPost(id) {
  if (!confirm("¿Eliminar este post?")) return;
  try {
    await db.collection("posts").doc(id).delete();
    _audit("delete_post", "Post eliminado: " + id);
    toast("✅ Post eliminado", "success");
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
    c.innerHTML = '<div class="es"><div class="ei">📝</div><div class="et">Sin publicaciones</div><div class="ex">Agrega tu primer post de Facebook</div></div>';
    return;
  }
  var h = "";
  var ad = S.user && S.user.role === "admin", canEdit = ad || (S.user && S.user.role === "gestionador");
  if (S.view === "grid") {
    h = '<div class="pg">';
    for (var i = 0; i < S.posts.length; i++) {
      var p = S.posts[i]; var img = p.images && p.images.length > 0 ? p.images[0] : "";
      h += '<div class="pc">' +
        (img ? '<div class="pi" onclick="pvImg(' + i + ')">' + catBadge(p.category) + (p.images.length > 1 ? '<span class="ic">' + p.images.length + ' 📷</span>' : '') + '<img src="' + escH(img) + '" alt="Post" loading="lazy"></div>' : '<div class="pn">' + catBadge(p.category) + '<span style="font-size:40px;color:#cbd5e1;">📝</span></div>') +
        '<div class="pb"><div class="pjt">' + escH(p.pageTitle || p.postText || "Sin título") + '</div>' +
        (p.postText && p.pageTitle ? '<div class="pjt2">' + escH(p.postText) + '</div>' : '') +
        '<div class="pm"><span>📅 ' + (p.postDate || "Sin fecha") + '</span><span>👤 ' + escH(p.addedBy) + '</span></div>' +
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
        '<div class="pm"><span>📅 ' + (p.postDate || "Sin fecha") + '</span><span>👤 ' + escH(p.addedBy) + '</span></div>' +
        postButtons(p, ad, canEdit) + '</div></div>';
    }
    h += '</div>';
  }
  c.innerHTML = h;
}

function renderPag() {
  var c = document.getElementById("pgC"); if (!c) return;
  if (S.tp <= 1) { c.innerHTML = ""; return; }
  var h = '<div class="pg2"><button ' + (S.page <= 1 ? "disabled" : "") + ' onclick="goP(' + (S.page - 1) + ')">← Anterior</button>';
  var s = Math.max(1, S.page - 2), e = Math.min(S.tp, S.page + 2);
  for (var i = s; i <= e; i++) { h += '<button class="' + (i === S.page ? "ac" : "") + '" onclick="goP(' + i + ')">' + i + '</button>'; }
  h += '<button ' + (S.page >= S.tp ? "disabled" : "") + ' onclick="goP(' + (S.page + 1) + ')">Siguiente →</button></div>';
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
  d.innerHTML = '<img src="' + escH(src) + '" alt="Imagen"><button class="ipc" onclick="closePv()">✕</button>' +
    (S.pvImg.length > 1 ? '<button class="ipn pv" onclick="pvNav(-1)">←</button><button class="ipn nx" onclick="pvNav(1)">→</button><div class="ipk">' + (S.pvIdx + 1) + ' / ' + S.pvImg.length + '</div>' : '');
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
        prv.innerHTML = '<img src="' + escH(r.meta.image) + '" alt="Vista previa"><button class="ipl" onclick="clearFetchPreview(\'' + prvId + '\')">✕ Quitar</button>';
      } else {
        prv.innerHTML = '<div class="iph">📝 No se encontró imagen en esta URL.<br>El post se guardará sin vista previa.</div>';
      }
    }
    if (titleField) {
      var tf = document.getElementById(titleField);
      if (tf && !tf.value.trim() && r.meta.title) tf.value = r.meta.title;
    }
    toast(r.meta.image ? "✅ Imagen encontrada" : "ℹ️ Sin imagen detectada", r.meta.image ? "success" : "info");
  } else {
    if (prv) prv.innerHTML = '<div class="iph">⚠️ No se pudo obtener la vista previa</div>';
    toast("No se pudo obtener la vista previa", "error");
  }
}

function clearFetchPreview(prvId) {
  var prv = document.getElementById(prvId);
  if (prv) prv.innerHTML = '<div class="iph">📷 La imagen se obtendrá automáticamente del enlace</div>';
  S.fetchedImage = "";
}

// ============ ADD POST ============
function openAdd() {
  S.fetchedImage = "";
  S.uploadedFile = null;
  S.uploadedUrl = "";
  var d = document.createElement("div"); d.id = "addM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>➕ Agregar Post</h3><button class="mc" onclick="clM(\'addM\')">✕</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">URL del post de Facebook</label><div style="display:flex;gap:8px;"><input type="url" id="aUrl" class="fi" placeholder="https://www.facebook.com/..." style="flex:1"><button class="btn bg bs" onclick="doFetchMeta(\'aUrl\',\'aPrv\',\'aTitle\')" style="white-space:nowrap">🔍 Vista previa</button></div></div>' +
    '<div id="aPrv" class="iprv"><div class="iph">📷 La imagen se obtendrá automáticamente del enlace</div></div>' +
    '<div class="fg"><label class="fl">O subir imagen desde tu dispositivo</label>' + _renderUploadArea("aFile", "") + '</div>' +
    '<div class="fg"><label class="fl">Texto del post</label><textarea id="aText" class="fi" rows="4" placeholder="Copia el texto del post aquí"></textarea></div>' +
    '<div class="fg"><label class="fl">Fecha del post</label><input type="date" id="aDate" class="fi"></div>' +
    '<div class="fg"><label class="fl">Título / Página</label><input type="text" id="aTitle" class="fi" placeholder="Nombre de la página o título"></div>' +
    '<div class="fg"><label class="fl">Categoría</label><select id="aCat" class="fi"><option value="auto">🎯 Automático (según palabras clave)</option><option value="historico">Histórico</option><option value="cultural">Cultural</option><option value="social">Social</option><option value="sin_clasificar">Sin Clasificar</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'addM\')">Cancelar</button><button class="btn bp" id="aBtn" onclick="doAdd()" style="width:auto">💾 Guardar</button></div></div>';
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

    // Subir imagen de archivo si existe
    if (S.uploadedFile) {
      b.textContent = "Subiendo imagen...";
      var uploadedUrl = await _uploadImageToStorage(S.uploadedFile, "new_" + Date.now());
      if (uploadedUrl) {
        imgs = [uploadedUrl]; // La imagen subida tiene prioridad
      }
    }

    var docRef = await db.collection("posts").add({
      url: url, postText: txt, postDate: dt, pageTitle: ttl,
      category: cat, addedBy: S.user.name,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      images: imgs
    });

    _audit("create_post", "Post creado: " + ttl + " (" + cat + ")");
    toast("✅ Post agregado — Clasificación: " + cat, "success");
    clM("addM"); S.fetchedImage = ""; S.uploadedFile = null; S.uploadedUrl = "";
  } catch (e) {
    toast("Error: " + e.message, "error");
    b.disabled = false; b.textContent = "💾 Guardar";
  }
}

// ============ EDIT POST ============
function openEditPost(postId) {
  var post = S.posts.find(function (x) { return x.id === postId; });
  if (!post) { toast("Post no encontrado", "error"); return; }
  S.editPostData = post;
  S.fetchedImage = post.images && post.images.length > 0 ? post.images[0] : "";
  S.uploadedFile = null;
  S.uploadedUrl = "";
  var currentImg = S.fetchedImage;
  var d = document.createElement("div"); d.id = "editPM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>✏️ Editar Post</h3><button class="mc" onclick="clM(\'editPM\')">✕</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">URL del post de Facebook</label><div style="display:flex;gap:8px;"><input type="url" id="eUrl" class="fi" value="' + escH(post.url) + '" placeholder="https://www.facebook.com/..." style="flex:1"><button class="btn bg bs" onclick="doFetchMeta(\'eUrl\',\'ePrv\',\'eTitle\')" style="white-space:nowrap">🔍 Vista previa</button></div></div>' +
    '<div id="ePrv" class="iprv">' + (currentImg ? '<img src="' + escH(currentImg) + '" alt="Vista previa"><button class="ipl" onclick="clearFetchPreview(\'ePrv\')">✕ Quitar</button>' : '<div class="iph">📷 La imagen se obtendrá automáticamente del enlace</div>') + '</div>' +
    '<div class="fg"><label class="fl">O subir imagen desde tu dispositivo</label>' + _renderUploadArea("eFile", "") + '</div>' +
    '<div class="fg"><label class="fl">Texto del post</label><textarea id="eText" class="fi" rows="4" placeholder="Copia el texto del post aquí">' + escH(post.postText || "") + '</textarea></div>' +
    '<div class="fg"><label class="fl">Fecha del post</label><input type="date" id="eDate" class="fi" value="' + escH(post.postDate || "") + '"></div>' +
    '<div class="fg"><label class="fl">Título / Página</label><input type="text" id="eTitle" class="fi" value="' + escH(post.pageTitle || "") + '" placeholder="Nombre de la página o título"></div>' +
    '<div class="fg"><label class="fl">Categoría</label><select id="eCat" class="fi"><option value="historico"' + (post.category === "historico" ? " selected" : "") + '>Histórico</option><option value="cultural"' + (post.category === "cultural" ? " selected" : "") + '>Cultural</option><option value="social"' + (post.category === "social" ? " selected" : "") + '>Social</option><option value="sin_clasificar"' + (post.category === "sin_clasificar" ? " selected" : "") + '>Sin Clasificar</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'editPM\')">Cancelar</button><button class="btn bp" id="eBtn" onclick="doEditPost(\'' + postId + '\')" style="width:auto">💾 Guardar Cambios</button></div></div>';
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
    // Subir imagen de archivo si existe
    if (S.uploadedFile) {
      b.textContent = "Subiendo imagen...";
      var uploadedUrl = await _uploadImageToStorage(S.uploadedFile, postId);
      if (uploadedUrl) {
        imgs = [uploadedUrl];
      }
    }

    await db.collection("posts").doc(postId).update({
      url: url, postText: txt, postDate: dt, pageTitle: ttl, category: cat, images: imgs
    });
    _audit("update_post", "Post editado: " + ttl);
    toast("✅ Post actualizado", "success");
    clM("editPM"); S.fetchedImage = ""; S.editPostData = null; S.uploadedFile = null; S.uploadedUrl = "";
  } catch (e) {
    toast("Error: " + e.message, "error");
    b.disabled = false; b.textContent = "💾 Guardar Cambios";
  }
}

// ============ CSV EXPORT ============
function exportCSV() {
  if (S.allPosts.length === 0) { toast("No hay posts para exportar", "error"); return; }

  var headers = ["Fecha Post", "Titulo", "Texto", "URL", "Categoria", "Agregado Por", "Fecha Creacion"];
  var rows = S.allPosts.map(function (p) {
    return [
      p.postDate || "",
      '"' + (p.pageTitle || "").replace(/"/g, '""') + '"',
      '"' + (p.postText || "").replace(/"/g, '""').replace(/\n/g, " ") + '"',
      '"' + (p.url || "") + '"',
      _catLabel(p.category),
      '"' + (p.addedBy || "").replace(/"/g, '""') + '"',
      p.createdAt ? (typeof p.createdAt === "string" ? p.createdAt : "") : ""
    ].join(",");
  });

  var csv = headers.join(",") + "\n" + rows.join("\n");
  var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ruletero222_posts_" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  _audit("export_csv", "Exportados " + S.allPosts.length + " posts a CSV");
  toast("✅ CSV exportado (" + S.allPosts.length + " posts)", "success");
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
  if (!S.dashData) return '<div class="do"><div class="dh"><h2>📊 Dashboard</h2><button class="hbn" onclick="togDash()">✕ Cerrar</button></div><div class="dc" style="display:flex;justify-content:center;padding:60px;"><div class="sp" style="width:40px;height:40px;"></div></div></div>';
  var d = S.dashData;
  var h = '<div class="do"><div class="dh"><h2>📊 Dashboard — Análisis de Contenido</h2><button class="hbn" onclick="togDash()">✕ Cerrar</button></div><div class="dc">';

  h += '<div class="kg"><div class="kc"><div class="kv">' + d.kpis.total + '</div><div class="kl">Total Publicaciones</div></div><div class="kc"><div class="kv">' + d.kpis.wImg + '</div><div class="kl">Con Imágenes</div></div><div class="kc"><div class="kv">' + d.kpis.uc + '</div><div class="kl">Contribuidores</div></div><div class="kc"><div class="kv">' + d.kpis.cc + '</div><div class="kl">Categorías Activas</div></div></div>';

  h += '<div class="cg">';
  h += '<div class="cc"><h4>📊 Distribución por Categoría</h4><div class="dnt"><div class="dn" style="background:conic-gradient(' + d.cats.map(function (c, i) { var off = d.cats.slice(0, i).reduce(function (s, x) { return s + x.value; }, 0); return c.color + ' ' + (off / d.kpis.total * 360) + 'deg ' + (off + c.value) / d.kpis.total * 360 + 'deg'; }).join(",") + ')"><div class="dnc"><div class="dnv">' + d.kpis.total + '</div><div class="dnl">Total</div></div></div><div class="dg">';
  for (var i = 0; i < d.cats.length; i++) { h += '<div class="li"><div class="ld" style="background:' + d.cats[i].color + '"></div>' + d.cats[i].name + '<span class="lv">' + d.cats[i].value + '</span></div>'; }
  h += '</div></div></div>';

  h += '<div class="cc"><h4>📅 Actividad por Día</h4>';
  var mx = Math.max.apply(null, d.days.map(function (x) { return x.c; })) || 1;
  for (var i = 0; i < d.days.length; i++) { h += '<div class="br"><div class="bl">' + d.days[i].d + '</div><div class="bt"><div class="bf" style="width:' + Math.round(d.days[i].c / mx * 100) + '%;background:' + (d.days[i].c === mx ? "var(--g)" : "var(--n)") + ';">' + d.days[i].c + '</div></div></div>'; }
  h += '</div></div>';

  h += '<div class="cg">';
  h += '<div class="cc"><h4>📈 Tendencia Mensual</h4>';
  if (d.months.length) {
    var mmx = 0; for (var i = 0; i < d.months.length; i++) { var t = d.months[i].historico + d.months[i].cultural + d.months[i].social + d.months[i].sin_clasificado; if (t > mmx) mmx = t; } mmx = mmx || 1;
    for (var i = 0; i < d.months.length; i++) { var t = d.months[i].historico + d.months[i].cultural + d.months[i].social + d.months[i].sin_clasificado; h += '<div class="br"><div class="bl">' + d.months[i].month + '</div><div class="bt"><div class="bf" style="width:' + Math.round(t / mmx * 100) + '%;background:var(--n);">' + t + '</div></div></div>'; }
  } else { h += '<p style="color:var(--m);font-size:13px;">Sin datos suficientes</p>'; }
  h += '</div>';

  h += '<div class="cc"><h4>🏆 Top Contribuidores</h4>';
  for (var i = 0; i < d.topC.length; i++) { h += '<div class="br"><div class="bl">' + escH(d.topC[i].name) + '</div><div class="bt"><div class="bf" style="width:' + Math.round(d.topC[i].count / (d.topC[0].count || 1) * 100) + '%;background:var(--g);">' + d.topC[i].count + '</div></div></div>'; }
  h += '</div></div>';

  if (d.insights && d.insights.length) {
    h += '<h3 style="font-size:16px;font-weight:700;color:var(--n);margin-bottom:16px;">💡 Insights Estratégicos</h3><div class="ig">';
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
      S.users.push({ id: doc.id, email: d.email, username: d.email, name: d.name, role: d.role, active: d.active, createdAt: d.createdAt });
    });
    renderApp();
  } catch (e) {
    toast("Error: " + e.message, "error");
    S.showUsers = false;
    renderApp();
  }
}

function rUsers() {
  if (!S.users) return '<div class="uo"><div class="dh"><h2>👥 Gestión de Usuarios</h2><button class="hbn" onclick="togUsers()">✕ Cerrar</button></div><div class="dc" style="display:flex;justify-content:center;padding:60px;"><div class="sp" style="width:40px;height:40px;"></div></div></div>';
  var h = '<div class="uo"><div class="dh"><h2>👥 Gestión de Usuarios</h2><div style="display:flex;align-items:center;gap:16px;"><button class="btn bg bs" onclick="openAddU()">➕ Nuevo Usuario</button><button class="hbn" onclick="togUsers()">✕ Cerrar</button></div></div><div class="dc"><table class="ut"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>';
  for (var i = 0; i < S.users.length; i++) {
    var u = S.users[i];
    h += '<tr><td>' + escH(u.name) + '</td><td>' + escH(u.email) + '</td><td><span class="rb ' + _roleBadgeCls(u.role) + '">' + _roleIcon(u.role) + ' ' + _roleLabel(u.role) + '</span></td><td class="' + (u.active ? "sa" : "si2") + '">' + (u.active ? "✅ Activo" : "❌ Inactivo") + '</td><td><button class="btn bo bs" onclick="openEditU(\'' + u.id + '\')">✏️</button> <button class="btn bw bs" onclick="sendResetEmail(\'' + u.id + '\')" title="Enviar email de reseteo de contraseña">📨</button> ' + (u.role !== "admin" || S.users.filter(function (x) { return x.role === "admin"; }).length > 1 ? '<button class="btn bd bs" onclick="togAct(\'' + u.id + '\',' + !u.active + ')">' + (u.active ? "Desactivar" : "Activar") + '</button> <button class="btn bd bs" onclick="delU(\'' + u.id + '\')">🗑</button>' : "") + '</td></tr>';
  }
  h += '</tbody></table></div></div>';
  return h;
}

function openAddU() {
  var d = document.createElement("div"); d.id = "addUM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>➕ Nuevo Usuario</h3><button class="mc" onclick="clM(\'addUM\')">✕</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">Nombre completo</label><input type="text" id="nuName" class="fi" placeholder="Ej: Juan Pérez"></div>' +
    '<div class="fg"><label class="fl">Correo electrónico</label><input type="email" id="nuEmail" class="fi" placeholder="Ej: juan@gmail.com"></div>' +
    '<div class="fg"><label class="fl">Contraseña</label><div class="pw"><input type="password" id="nuPass" class="fi" placeholder="Mínimo 6 caracteres"><button type="button" class="pt" onclick="togglePw(\'nuPass\',this)">👁</button></div></div>' +
    '<div class="fg"><label class="fl">Rol</label><select id="nuRole" class="fi"><option value="viewer">👁 Visualizador</option><option value="gestionador">✏️ Gestionador</option><option value="admin">🛡 Administrador</option></select></div>' +
    '<div style="margin-top:8px;padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:11px;color:#1e40af;line-height:1.5;"><strong>💡 Importante:</strong> Usa un correo electrónico real. El usuario podrá resetear su contraseña recibiendo un email a esta dirección.</div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'addUM\')">Cancelar</button><button class="btn bp" id="nuBtn" onclick="doAddU()" style="width:auto">💾 Crear</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doAddU() {
  var n = document.getElementById("nuName").value.trim(),
    e = document.getElementById("nuEmail").value.trim().toLowerCase(),
    p = document.getElementById("nuPass").value,
    r = document.getElementById("nuRole").value;

  if (!n || !e || !p) { toast("Todos los campos son requeridos", "error"); return; }
  if (e.indexOf("@") === -1) { toast("Ingresa un correo electrónico válido", "error"); return; }
  if (p.length < 6) { toast("Contraseña: mínimo 6 caracteres", "error"); return; }
  var b = document.getElementById("nuBtn"); b.disabled = true;

  try {
    var existing = await db.collection("users").where("email", "==", e).limit(1).get();
    if (!existing.empty) { toast("Ya existe un usuario con ese correo", "error"); b.disabled = false; return; }

    var secondaryApp = firebase.initializeApp(firebase.app().options, "Secondary" + Date.now());
    var cred = await secondaryApp.auth().createUserWithEmailAndPassword(e, p);
    var newUid = cred.user.uid;

    await db.collection("users").doc(newUid).set({
      email: e, name: n, role: r, active: true,
      createdAt: new Date().toISOString(), uid: newUid
    });

    await secondaryApp.auth().signOut();
    secondaryApp.delete().catch(function () { });

    _audit("create_user", "Usuario creado: " + n + " (" + e + ") - Rol: " + _roleLabel(r));
    toast("✅ Usuario creado", "success");
    clM("addUM");
    loadU();
  } catch (err) {
    var msg = err.message;
    if (err.code === "auth/email-already-in-use") msg = "Ya existe una cuenta con ese correo en Firebase";
    toast("Error: " + msg, "error");
    b.disabled = false;
  }
}

function openEditU(uid) {
  var u = S.users.find(function (x) { return x.id === uid; }); if (!u) return;
  var d = document.createElement("div"); d.id = "editUM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>✏️ Editar Usuario</h3><button class="mc" onclick="clM(\'editUM\')">✕</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">Nombre</label><input type="text" id="euName" class="fi" value="' + escH(u.name) + '"></div>' +
    '<div class="fg"><label class="fl">Correo electrónico</label><input type="email" id="euEmail" class="fi" value="' + escH(u.email) + '" readonly style="background:#f1f5f9;cursor:not-allowed;"><div style="font-size:11px;color:var(--m);margin-top:4px;">El correo no se puede cambiar (es el identificador de la cuenta)</div></div>' +
    '<div class="fg"><label class="fl">Contraseña</label><div style="padding:10px 0;"><button type="button" class="btn bw bs" onclick="sendResetEmail(\'' + uid + '\')">📨 Enviar email de reseteo</button><span style="display:block;margin-top:6px;font-size:11px;color:var(--m);">Se enviará un correo a <strong>' + escH(u.email) + '</strong> para que el usuario cambie su contraseña.</span></div></div>' +
    '<div class="fg"><label class="fl">Rol</label><select id="euRole" class="fi"><option value="viewer"' + (u.role === "viewer" ? " selected" : "") + '>👁 Visualizador</option><option value="gestionador"' + (u.role === "gestionador" ? " selected" : "") + '>✏️ Gestionador</option><option value="admin"' + (u.role === "admin" ? " selected" : "") + '>🛡 Administrador</option></select></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'editUM\')">Cancelar</button><button class="btn bp" onclick="doEditU(\'' + uid + '\')" style="width:auto">💾 Guardar</button></div></div>';
  document.body.appendChild(d); setTimeout(function () { d.classList.add("ac"); }, 50);
}

async function doEditU(uid) {
  var n = document.getElementById("euName").value.trim(),
    r = document.getElementById("euRole").value;

  try {
    await db.collection("users").doc(uid).update({ name: n, role: r });
    _audit("update_user", "Usuario editado: " + n + " - Rol: " + _roleLabel(r));
    toast("✅ Usuario actualizado", "success");
    clM("editUM"); loadU();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function togAct(uid, act) {
  try {
    await db.collection("users").doc(uid).update({ active: act });
    _audit("toggle_user", "Usuario " + (act ? "activado" : "desactivado") + ": " + uid);
    toast(act ? "✅ Activado" : "🔴 Desactivado", "success");
    loadU();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function delU(uid) {
  if (!confirm("¿Eliminar este usuario?")) return;
  try {
    await db.collection("users").doc(uid).delete();
    _audit("delete_user", "Usuario eliminado: " + uid);
    toast("✅ Eliminado", "success");
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
  var curLogo = S.logoUrl || (S.settingsData && S.settingsData.logoUrl) || "";
  var h = '<div class="so"><div class="dh"><h2>⚙️ Configuración</h2><button class="hbn" onclick="togSettings()">✕ Cerrar</button></div><div class="sc">';

  h += '<div class="slg"><h4>🎨 Logo de la Aplicación</h4><p>Sube una imagen desde tu dispositivo o pega una URL. Se recomienda PNG cuadrado con fondo transparente.</p>';
  h += '<div class="sprv"><div>' + (curLogo ? '<div class="lo" style="background:#fff;display:flex;align-items:center;justify-content:center;"><img src="' + escH(curLogo) + '" alt="Logo"></div>' : logoHTML("lo", "lg")) + '</div><div>' + (curLogo ? '<div class="hl" style="background:#fff;display:flex;align-items:center;justify-content:center;"><img src="' + escH(curLogo) + '" alt="Logo"></div>' : logoHTML("hl", "md")) + '</div><div>' + (curLogo ? '<div class="fl2" style="background:#fff;display:flex;align-items:center;justify-content:center;"><img src="' + escH(curLogo) + '" alt="Logo"></div>' : logoHTML("fl2", "sm")) + '</div><div><div class="sprv-label">Vista previa: Login | Header | Footer</div></div></div>';
  h += '<div class="fg"><label class="fl">📁 Subir logo desde tu dispositivo</label><div class="iupload" onclick="document.getElementById(\'logoFile\').click()"><input type="file" id="logoFile" accept="image/*" onchange="uploadLogo(this)" style="display:none"><div class="iupload-icon">🖼️</div><div class="iupload-text">Haz clic para subir tu logo</div><div class="iupload-hint">PNG, JPG, WEBP — Máximo 5 MB</div><div id="logoProgress" class="iupload-progress" style="display:none"><div id="logoBar" class="iupload-progress-bar" style="width:0%"></div></div></div></div>';
  h += '<div style="text-align:center;color:var(--m);font-size:12px;margin:12px 0;">— o pega una URL manualmente —</div>';
  h += '<div class="fg"><label class="fl">URL del Logo</label><input type="url" id="sLogoUrl" class="fi" value="' + escH(curLogo) + '" placeholder="https://ejemplo.com/mi-logo.png"></div>';
  h += '<div style="display:flex;gap:10px;"><button class="btn bp" onclick="saveLogo()" style="width:auto;flex:1">💾 Guardar URL</button>' + (curLogo ? '<button class="btn bd" onclick="removeLogo()" style="width:auto">🗑 Quitar Logo</button>' : '') + '</div>';
  h += '</div>';

  h += '<div class="slg"><h4>📋 Información del Sistema</h4><div style="font-size:13px;color:var(--m);line-height:1.8;">';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Aplicación</span><strong style="color:var(--n)">RULETERO 222</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Plataforma</span><strong style="color:var(--n)">GitHub Pages + Firebase</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Versión</span><strong style="color:var(--n)">7.0</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Modo oscuro</span><strong style="color:' + (S.darkMode ? "#22c55e" : "#ef4444") + '">' + (S.darkMode ? "Activado" : "Desactivado") + '</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--bd);padding:6px 0;"><span>Tiempo real</span><strong style="color:#22c55e;">Activado</strong></div>';
  h += '<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>Estado del Logo</span><strong style="color:' + (curLogo ? "#22c55e" : "#ef4444") + '">' + (curLogo ? "Configurado" : "Sin configurar (letra R)") + '</strong></div>';
  h += '</div></div>';

  // Audit log section (admin only)
  if (S.user && S.user.role === "admin") {
    h += '<div class="slg"><h4>📜 Registro de Auditoría (últimas 20 acciones)</h4><div id="auditLogContainer"><div style="text-align:center;padding:20px;"><div class="sp" style="width:24px;height:24px;margin:0 auto 8px;"></div>Cargando...</div></div></div>';
  }

  h += '</div></div>';
  return h;
}

async function loadAuditLog() {
  var container = document.getElementById("auditLogContainer");
  if (!container) return;
  try {
    var snapshot = await db.collection("audit").orderBy("timestamp", "desc").limit(20).get();
    if (snapshot.empty) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--m);font-size:13px;">Sin registros de auditoría</div>';
      return;
    }
    var h = '<table class="audit-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Detalles</th></tr></thead><tbody>';
    snapshot.forEach(function (doc) {
      var d = doc.data();
      var date = d.timestamp ? new Date(d.timestamp.seconds * 1000).toLocaleString("es-MX") : "—";
      var actionType = (d.action || "").split("_")[0];
      var actionClass = "audit-other";
      if (actionType === "create") actionClass = "audit-create";
      else if (actionType === "update") actionClass = "audit-update";
      else if (actionType === "delete") actionClass = "audit-delete";
      else if (d.action === "login" || d.action === "logout") actionClass = "audit-login";
      h += '<tr><td style="white-space:nowrap;">' + escH(date) + '</td><td><span class="audit-action ' + actionClass + '">' + escH(d.action) + '</span></td><td>' + escH(d.userName || "—") + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escH(d.details || "") + '">' + escH(d.details || "—") + '</td></tr>';
    });
    h += '</tbody></table>';
    container.innerHTML = h;
  } catch (e) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#ef4444;font-size:13px;">Error cargando auditoría: ' + escH(e.message) + '</div>';
  }
}

async function saveLogo() {
  var url = document.getElementById("sLogoUrl").value.trim();
  try {
    await db.collection("config").doc("app").set({ logoUrl: url }, { merge: true });
    S.logoUrl = url;
    if (S.settingsData) S.settingsData.logoUrl = url;
    localStorage.setItem("rt_lu", url);
    _audit("update_settings", "Logo actualizado via URL");
    toast("✅ Logo guardado correctamente", "success");
    renderApp();
    setTimeout(loadAuditLog, 100);
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function uploadLogo(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast("La imagen no debe superar 5 MB", "error"); return; }
  if (!file.type.startsWith("image/")) { toast("Solo se permiten imágenes", "error"); return; }

  toast("Subiendo logo...", "info");
  var prog = document.getElementById("logoProgress");
  var bar = document.getElementById("logoBar");
  if (prog) prog.style.display = "block";

  try {
    var ref = storage.ref("config/logo_" + Date.now() + "_" + file.name);
    var uploadTask = ref.put(file);

    var url = await new Promise(function (resolve, reject) {
      uploadTask.on("state_changed",
        function (snapshot) {
          var progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          if (bar) bar.style.width = progress + "%";
        },
        function (error) { reject(error); },
        function () {
          uploadTask.snapshot.ref.getDownloadURL().then(resolve).catch(reject);
        }
      );
    });

    await db.collection("config").doc("app").set({ logoUrl: url }, { merge: true });
    S.logoUrl = url;
    if (S.settingsData) S.settingsData.logoUrl = url;
    localStorage.setItem("rt_lu", url);
    _audit("update_settings", "Logo subido desde archivo");
    toast("✅ Logo subido correctamente", "success");
    renderApp();
    setTimeout(loadAuditLog, 100);
  } catch (e) {
    toast("Error al subir logo: " + e.message, "error");
    if (prog) prog.style.display = "none";
  }
}

async function removeLogo() {
  if (!confirm("¿Quitar el logo y volver a la letra R?")) return;
  try {
    await db.collection("config").doc("app").set({ logoUrl: "" }, { merge: true });
    S.logoUrl = "";
    if (S.settingsData) S.settingsData.logoUrl = "";
    localStorage.setItem("rt_lu", "");
    _audit("update_settings", "Logo eliminado");
    toast("✅ Logo eliminado", "success");
    renderApp();
    setTimeout(loadAuditLog, 100);
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
    '<button class="hbn" onclick="togDash()">📊 <span>Dashboard</span></button>' +
    (ad ? '<button class="hbn gold" onclick="togUsers()">👥 <span>Usuarios</span></button><button class="hbn" onclick="togSettings()">⚙️ <span>Config</span></button>' : '') +
    '<div class="ui"><div class="uv ' + _roleUVCls(S.user.role) + '">' + _roleIcon(S.user.role) + '</div><div><div style="font-size:12px;font-weight:600">' + escH(S.user.name) + '</div><div style="font-size:10px;color:rgba(255,255,255,.5)">' + _roleLabel(S.user.role) + '</div></div></div>' +
    '<button class="hbn" onclick="_toggleDarkMode()" title="Cambiar modo claro/oscuro">' + (S.darkMode ? "☀️" : "🌙") + ' <span>' + (S.darkMode ? "Claro" : "Oscuro") + '</span></button>' +
    '<button class="hbn" onclick="openChangeMyPw()">🔑 <span>Contraseña</span></button>' +
    '<button class="hbn" onclick="doLogout()">🚪 <span>Salir</span></button></div></div><div class="hgl"></div></header>' +
    '<main class="mn">' +
    (canAdd ? '<button class="btn bg" onclick="openAdd()" style="margin-bottom:16px;">➕ Agregar Post</button>' : '<div class="vn">👁 Modo visualizador — Solo puedes ver el contenido.</div>') +
    '<div class="tb"><div><div class="tt">Publicaciones Guardadas</div><div style="display:flex;align-items:center;gap:10px;"><div class="tc">' + S.total + ' publicaciones</div><span class="rt-indicator"><span class="rt-dot"></span>En vivo</span></div></div><div class="ta">' +
    '<div class="sb"><span class="si">🔍</span><input type="text" placeholder="Buscar..." value="' + escH(S.search) + '" oninput="doSearch(this.value)"></div>' +
    '<select id="yFilter" class="fi" style="padding:10px 12px;border:2px solid var(--bd);border-radius:10px;font-size:13px;width:auto;min-width:130px;outline:none;cursor:pointer;background:var(--cb)" onchange="doYearFilter(this.value)"><option value="todos">Todos los años</option></select>' +
    '<button class="btn bo bs" onclick="exportCSV()" title="Exportar a CSV">📥 CSV</button>' +
    '<div class="vt"><button class="vb ' + (S.view === "grid" ? "ac" : "") + '" onclick="setV(\'grid\')">▦</button><button class="vb ' + (S.view === "list" ? "ac" : "") + '" onclick="setV(\'list\')">☰</button></div></div></div>' +
    '<div id="pC"></div><div id="pgC"></div></main>' +
    '<footer class="ft"><div class="fgl"></div><div class="fi2"><div class="fb">' + logoHTML("fl2", "sm") + '<span style="font-size:13px;font-weight:700;">RULETERO 222</span><span style="color:var(--g);font-size:11px;">|</span><span style="font-size:11px;color:rgba(255,255,255,.6);">La Ruta de los Poblanos</span></div><div class="fc">© ' + new Date().getFullYear() + ' Gestor de Posts v7.0</div></div></footer>';

  if (!S.loading) renderPosts();
  if (S.showSettings && ad) setTimeout(loadAuditLog, 200);
}

// ============ CHANGE MY PASSWORD ============
function openChangeMyPw() {
  var d = document.createElement("div"); d.id = "chPwM"; d.className = "mo";
  d.innerHTML = '<div class="md"><div class="mh"><h3>🔑 Cambiar Mi Contraseña</h3><button class="mc" onclick="clM(\'chPwM\')">✕</button></div>' +
    '<div class="mb">' +
    '<div class="fg"><label class="fl">Contraseña actual</label><div class="pw"><input type="password" id="cpCur" class="fi" placeholder="Tu contraseña actual"><button type="button" class="pt" onclick="togglePw(\'cpCur\',this)">👁</button></div></div>' +
    '<div class="fg"><label class="fl">Nueva contraseña</label><div class="pw"><input type="password" id="cpNew" class="fi" placeholder="Mínimo 6 caracteres"><button type="button" class="pt" onclick="togglePw(\'cpNew\',this)">👁</button></div></div>' +
    '<div class="fg"><label class="fl">Confirmar nueva contraseña</label><div class="pw"><input type="password" id="cpConf" class="fi" placeholder="Repite la nueva contraseña"><button type="button" class="pt" onclick="togglePw(\'cpConf\',this)">👁</button></div></div>' +
    '</div><div class="mf"><button class="btn bo" onclick="clM(\'chPwM\')">Cancelar</button><button class="btn bp" id="cpBtn" onclick="doChangeMyPw()" style="width:auto">💾 Cambiar</button></div></div>';
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
    if (!user) { toast("No hay sesión activa", "error"); b.disabled = false; b.textContent = "💾 Cambiar"; return; }
    var credential = firebase.auth.EmailAuthProvider.credential(user.email, cur);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(nw);
    _audit("change_password", "Contraseña cambiada");
    toast("✅ Contraseña cambiada correctamente", "success");
    clM("chPwM");
  } catch (e) {
    var msg = "Error al cambiar la contraseña";
    if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") msg = "La contraseña actual es incorrecta";
    else if (e.code === "auth/too-many-requests") msg = "Demasiados intentos. Espera un momento";
    else if (e.code === "auth/requires-recent-login") msg = "Tu sesión expiró. Cierra sesión e inicia de nuevo";
    else if (e.message) msg = e.message;
    toast(msg, "error");
    b.disabled = false; b.textContent = "💾 Cambiar";
  }
}

// ============ RESET PASSWORD (ADMIN) ============
async function sendResetEmail(uid) {
  var u = S.users.find(function (x) { return x.id === uid; });
  if (!u) { toast("Usuario no encontrado", "error"); return; }

  var email = u.email;
  if (!email) { toast("Este usuario no tiene correo electrónico registrado", "error"); return; }

  if (!confirm('¿Enviar email de reseteo de contraseña a ' + email + '?\n\nEl usuario recibirá un correo de Firebase para cambiar su contraseña.')) return;

  try {
    await auth.sendPasswordResetEmail(email);
    _audit("reset_password", "Email de reseteo enviado a: " + email);
    toast("✅ Email de reseteo enviado a " + email, "success");
  } catch (e) {
    var msg = "Error al enviar email de reseteo";
    if (e.code === "auth/user-not-found") msg = "No se encontró la cuenta de Firebase para este correo";
    else if (e.code === "auth/too-many-requests") msg = "Demasiados intentos. Espera un momento";
    else if (e.message) msg = e.message;
    toast(msg, "error");
  }
}

// ============ UTILS ============
function clM(id) { var d = document.getElementById(id); if (d) { d.classList.remove("ac"); setTimeout(function () { d.remove(); }, 300); } }

// ============ INICIALIZACIÓN DEL SISTEMA ============
async function setupInitialAdmin() {
  try {
    var adminEmail = "tu-correo-real@gmail.com";
    var existing = await db.collection("users").where("email", "==", adminEmail).limit(1).get();
    if (!existing.empty) {
      toast("Ya existe un usuario con ese correo", "info");
      return;
    }
    var cred = await auth.createUserWithEmailAndPassword(adminEmail, "admin123");
    var uid = cred.user.uid;
    await db.collection("users").doc(uid).set({
      email: adminEmail,
      name: "Administrador",
      role: "admin",
      active: true,
      createdAt: new Date().toISOString(),
      uid: uid
    });
    await db.collection("config").doc("app").set({ logoUrl: "" }, { merge: true });
    await auth.signOut();
    toast("✅ Admin creado. Email: " + adminEmail + " | Contraseña: admin123", "success");
    toast("⚠️ Cambia la contraseña después de iniciar sesión", "info");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
}

// ============ START ============
// init() se llama al final de index.html
