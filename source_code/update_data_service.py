import re

with open('src/services/dataService.ts', 'r') as f:
    content = f.read()

# Replace getDocs
content = re.sub(
    r"const snapshot = await getDocs\(collection\(db, '([^']+)'\)\);",
    r"const snapshot = await firestoreCall(OperationType.LIST, '\1', async () => await getDocs(collection(db, '\1')));",
    content
)

# Replace getDoc
content = re.sub(
    r"const docSnap = await getDoc\(docRef\);",
    r"const docSnap = await firestoreCall(OperationType.GET, docRef.path, async () => await getDoc(docRef));",
    content
)

# Replace setDoc
content = re.sub(
    r"await setDoc\(docRef, ([^,]+), \{ merge: true \}\);",
    r"await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, \1, { merge: true }));",
    content
)

# Replace deleteDoc
content = re.sub(
    r"await deleteDoc\(doc\(db, '([^']+)', ([^)]+)\)\);",
    r"await firestoreCall(OperationType.DELETE, '\1', async () => await deleteDoc(doc(db, '\1', \2)));",
    content
)

# Replace addDoc
content = re.sub(
    r"await addDoc\(collection\(db, '([^']+)'\), ([^)]+)\);",
    r"await firestoreCall(OperationType.CREATE, '\1', async () => await addDoc(collection(db, '\1'), \2));",
    content
)

# Replace updateDoc
content = re.sub(
    r"await updateDoc\(docRef, ([^)]+)\);",
    r"await firestoreCall(OperationType.UPDATE, docRef.path, async () => await updateDoc(docRef, \1));",
    content
)

# Replace onSnapshot
content = re.sub(
    r"onSnapshot\(collection\(db, '([^']+)'\), \(([^)]+)\) => \{([\s\S]*?)\}, \(([^)]+)\) => \{([\s\S]*?)\}\);",
    r"onSnapshot(collection(db, '\1'), (\2) => {\3}, (\4) => { handleFirestoreError(\4, OperationType.LIST, '\1'); \5});",
    content
)

with open('src/services/dataService.ts', 'w') as f:
    f.write(content)

print("Done")
