/**
 * RULETERO 222 - Configuración de Firebase
 * 
 * INSTRUCCIONES:
 * 1. Crea un proyecto en https://console.firebase.google.com/
 * 2. Activa Authentication > Email/Password
 * 3. Crea una base de datos Firestore
 * 4. Copia tu configuración desde Project Settings > General > Your apps > Web app
 * 5. Pega los valores aquí abajo
 */

const firebaseConfig = {
  apiKey: "AIzaSyBlbkpfPmpQ4MwNfEVh5VRvjnkuj7--ieM",
  authDomain: "ruletero222-85e13.firebaseapp.com",
  projectId: "ruletero222-85e13",
  storageBucket: "ruletero222-85e13.firebasestorage.app",
  messagingSenderId: "105603824952",
  appId: "1:105603824952:web:743449ba48e2bddb5e15cd"
};

// NO modificar nada debajo de esta línea
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Habilitar persistencia offline para mejor rendimiento
db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore: múltiples pestañas abiertas, persistencia deshabilitada');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore: navegador no soporta persistencia');
  }
});
