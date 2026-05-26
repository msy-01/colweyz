const fs = require('fs');

let content = fs.readFileSync('src/services/dataService.ts', 'utf8');

// Replace getDocs(collection(db, 'xxx'))
content = content.replace(/const snapshot = await getDocs\(collection\(db, '([^']+)'\)\);/g, 
  "const snapshot = await firestoreCall(OperationType.LIST, '$1', async () => await getDocs(collection(db, '$1')));");

// Replace getDoc(doc(db, 'xxx', id))
content = content.replace(/const docSnap = await getDoc\(docRef\);/g, 
  "const docSnap = await firestoreCall(OperationType.GET, docRef.path, async () => await getDoc(docRef));");

// Replace setDoc(docRef, ...)
content = content.replace(/await setDoc\(docRef, ([^,]+), \{ merge: true \}\);/g, 
  "await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, $1, { merge: true }));");

// Replace deleteDoc(doc(db, 'xxx', id))
content = content.replace(/await deleteDoc\(doc\(db, '([^']+)', ([^)]+)\)\);/g, 
  "await firestoreCall(OperationType.DELETE, '$1', async () => await deleteDoc(doc(db, '$1', $2)));");

// Replace addDoc(collection(db, 'xxx'), ...)
content = content.replace(/await addDoc\(collection\(db, '([^']+)'\), ([^)]+)\);/g, 
  "await firestoreCall(OperationType.CREATE, '$1', async () => await addDoc(collection(db, '$1'), $2));");

// Replace updateDoc(docRef, ...)
content = content.replace(/await updateDoc\(docRef, ([^)]+)\);/g, 
  "await firestoreCall(OperationType.UPDATE, docRef.path, async () => await updateDoc(docRef, $1));");

// Update onSnapshot
content = content.replace(/onSnapshot\(collection\(db, '([^']+)'\), \(([^)]+)\) => \{([\s\S]*?)\}, \(([^)]+)\) => \{([\s\S]*?)\}\);/g, 
  "onSnapshot(collection(db, '$1'), ($2) => {$3}, ($4) => { handleFirestoreError($4, OperationType.LIST, '$1'); $5});");

fs.writeFileSync('src/services/dataService.ts', content);
console.log("Done");
