/**
 * Photo Management Utilities for Cimory SIAP Web Tool
 */

/**
 * Initialize IndexedDB
 */
function initIndexedDB() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
        console.error('IndexedDB failed to open');
    };
    
    request.onsuccess = (event) => {
        photoDB = event.target.result;
        console.log('IndexedDB initialized');
    };
    
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            objectStore.createIndex('category', 'category', { unique: false });
            objectStore.createIndex('storeCode', 'storeCode', { unique: false });
        }
    };
}

/**
 * Setup photo input listeners
 */
function setupPhotoListeners() {
    if (photoCheckinInput) {
        photoCheckinInput.addEventListener('change', (e) => handlePhotoUpload(e, 'checkin', 1));
    }
    if (photoBeforeInput) {
        photoBeforeInput.addEventListener('change', (e) => handlePhotoUpload(e, 'before', 4));
    }
    if (photoAfterInput) {
        photoAfterInput.addEventListener('change', (e) => handlePhotoUpload(e, 'after', 4));
    }
}

/**
 * Handle photo upload from file input
 */
async function handlePhotoUpload(event, category, maxFiles) {
    const files = Array.from(event.target.files).slice(0, maxFiles);
    const previewDiv = document.getElementById(`preview-${category}`);
    
    if (files.length === 0) return;
    
    previewDiv.innerHTML = '<p style="font-size:0.85rem;color:#8b949e;">Processing...</p>';
    
    const processedPhotos = [];
    
    for (const file of files) {
        try {
            const compressed = await compressImage(file);
            const thumbnail = await generateThumbnail(file);
            
            processedPhotos.push({
                filename: generatePhotoFilename(),
                base64: compressed,
                thumbnail: thumbnail,
                timestamp: new Date()
            });
        } catch (err) {
            console.error('Error processing photo:', err);
        }
    }
    
    // Store in memory
    photosByCategory[category] = processedPhotos;
    
    // Update preview
    previewDiv.innerHTML = `<p style="font-size:0.85rem;color:#2ea043;">${processedPhotos.length} photo(s) uploaded</p>`;
}

/**
 * Compress image to <1MB Base64
 */
function compressImage(file, maxSizeKB = 1024) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Resize if needed (max 1920px width)
                const maxWidth = 1920;
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Try different quality levels to get under max size
                let quality = 0.9;
                let base64 = canvas.toDataURL('image/jpeg', quality);
                
                while (base64.length > maxSizeKB * 1024 && quality > 0.1) {
                    quality -= 0.1;
                    base64 = canvas.toDataURL('image/jpeg', quality);
                }
                
                resolve(base64);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Compress image to HD Blob for Telegram (1920px, 80% quality)
 * Returns a Blob, not base64, so it can be used with FormData directly.
 */
function compressImageHD(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                const maxWidth = 1920;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Output as Blob (more memory efficient than base64 for large files)
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('canvas.toBlob failed'));
                }, 'image/jpeg', 0.80);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Generate 100x100 thumbnail
 */
function generateThumbnail(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 100;
                canvas.height = 100;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 100, 100);
                
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Generate filename: JPEG_yyyyMMdd_HHmmss_.jpg
 */
function generatePhotoFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    
    return `JPEG_${year}${month}${day}_${hour}${minute}${second}_.jpg`;
}

/**
 * Generate timestamp with jitter (for natural timing)
 */
function generatePhotoTimestamp(baseTime, minOffsetMin, maxOffsetMin) {
    const offsetMs = (Math.random() * (maxOffsetMin - minOffsetMin) + minOffsetMin) * 60 * 1000;
    return new Date(baseTime.getTime() + offsetMs);
}

/**
 * Get GroupCode for category
 */
function getGroupCode(category) {
    const codes = {
        'checkin': '001       ',  // 10 chars with trailing spaces
        'before': '002       ',
        'after': '003       '
    };
    return codes[category] || '';
}
