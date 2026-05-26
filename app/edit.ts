import * as fs from 'fs';

let content = fs.readFileSync('services/dataService.ts', 'utf8');

// Replace getDocs
content = content.replace(/const snapshot = await getDocs\(collection\(db, '([^']+)'\)\);/g, 
  "const snapshot = await firestoreCall(OperationType.LIST, '$1', async () => await getDocs(collection(db, '$1')));");

// Replace getDoc
content = content.replace(/const docSnap = await getDoc\(docRef\);/g, 
  "const docSnap = await firestoreCall(OperationType.GET, docRef.path, async () => await getDoc(docRef));");

// Replace setDoc
content = content.replace(/await setDoc\(docRef, ([^,]+), \{ merge: true \}\);/g, 
  "await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, $1, { merge: true }));");

// Replace deleteDoc
content = content.replace(/await deleteDoc\(doc\(db, '([^']+)', ([^)]+)\)\);/g, 
  "await firestoreCall(OperationType.DELETE, '$1', async () => await deleteDoc(doc(db, '$1', $2)));");

// Replace addDoc
content = content.replace(/await addDoc\(collection\(db, '([^']+)'\), ([^)]+)\);/g, 
  "await firestoreCall(OperationType.CREATE, '$1', async () => await addDoc(collection(db, '$1'), $2));");

// Replace updateDoc
content = content.replace(/await updateDoc\(docRef, ([^)]+)\);/g, 
  "await firestoreCall(OperationType.UPDATE, docRef.path, async () => await updateDoc(docRef, $1));");

// Update onSnapshot
content = content.replace(/onSnapshot\(collection\(db, '([^']+)'\), \(([^)]+)\) => \{([\s\S]*?)\}, \(([^)]+)\) => \{([\s\S]*?)\}\);/g, 
  "onSnapshot(collection(db, '$1'), ($2) => {$3}, ($4) => { handleFirestoreError($4, OperationType.LIST, '$1'); $5});");

fs.writeFileSync('services/dataService.ts', content);
console.log("Done");
