const firebaseConfig = {
  apiKey: "AIzaSyBlbkpfPmpQ4MwNfEVh5VRvjnkuj7--ieM",
  authDomain: "ruletero222-85e13.firebaseapp.com",
  projectId: "ruletero222-85e13",
  storageBucket: "ruletero222-85e13.firebasestorage.app",
  messagingSenderId: "105603824952",
  appId: "1:105603824952:web:743449ba48e2bddb5e15cd"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore: múltiples pestañas abiertas');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore: navegador no soporta persistencia');
  }
});
