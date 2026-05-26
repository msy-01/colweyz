import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ⚠️ INSTRUCTIONS IMPORTANTES :
// 1. Allez sur console.firebase.google.com
// 2. Créez un projet -> Ajoutez une app Web
// 3. Copiez les valeurs de "firebaseConfig" et remplacez-les ci-dessous

const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};

// Initialisation conditionnelle pour éviter les erreurs si la config n'est pas faite
let app;
let db: any;

try {
    if (firebaseConfig.apiKey !== "REPLACE_WITH_YOUR_API_KEY") {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        console.log("Firebase connecté ✅");
    } else {
        console.warn("⚠️ Firebase non configuré. L'application utilise le stockage local (Mode Démo).");
    }
} catch (error) {
    console.error("Erreur init Firebase:", error);
}

export { db };
