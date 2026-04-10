/**
 * Cimory SIAP Web Tool V2 - Multi-Store Logic
 */

// ============================================
// STATE MANAGEMENT
// ============================================
let rkmData = null;
let storeStates = {}; // { storeCode: { data, checkInTime, checkOutTime, photos, stock, gps, status } }
let externalStockData = {};
const STOCK_API_URL = "https://raw.githubusercontent.com/yprtm-195/webstok/refs/heads/main/docs/live_stock.json";

// IndexedDB
let photoDB = null;
const DB_NAME = 'CimorySIAPPhotos';
const DB_VERSION = 2; // Bumped for session store
const STORE_NAME = 'photos';
const STORE_SESSION = 'session';

// ============================================
// DOM ELEMENTS
// ============================================
const fileInput = document.getElementById('file-input');
const uploadZone = document.getElementById('upload-zone');
const uploadStatus = document.getElementById('upload-status');
const storesContainer = document.getElementById('stores-container');
// const outputSection = document.getElementById('output-section'); // Removed in v2 Shell
const storesCountEl = document.getElementById('stores-count');

const btnUpload = document.getElementById('btn-upload');
const uploadProgress = document.getElementById('upload-progress');

// CONFIG
const MOCK_UPLOAD = false; // Set to false for Production

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Tombol upload disabled by default sampai ada toko siap
    if (btnUpload) { btnUpload.disabled = true; btnUpload.style.opacity = '0.45'; }

    initIndexedDB();
    fetchExternalStock();
    setupPayloadGeneration();
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
});

// ============================================
// UPLOAD SECTION TOGGLE
// ============================================
// Upload Section Toggle Removed
// Auto-collapse upload section removed

// ============================================
// INDEXEDDB
// ============================================
function initIndexedDB() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (e) => console.error('IndexedDB error:', e.target.error);

    request.onsuccess = (e) => { 
        photoDB = e.target.result;
        console.log('DB init success, checking for session...');
        checkAndRestoreSession();
    };
    
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // Photos store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('storeCode', 'storeCode', { unique: false });
        }
        
        // Session store (New in v2)
        if (!db.objectStoreNames.contains(STORE_SESSION)) {
            db.createObjectStore(STORE_SESSION, { keyPath: 'key' });
        }
    };
}

// Session Management
async function saveSession() {
    if (!photoDB || !rkmData) return;
    
    const tx = photoDB.transaction(STORE_SESSION, 'readwrite');
    const store = tx.objectStore(STORE_SESSION);
    
    store.put({ key: 'rkmData', value: rkmData });
    
    // Strip non-serializable properties (Leaflet map/marker instances) before saving
    const serializableStates = {};
    for (const code in storeStates) {
        const { mapInstance, userMarker, ...rest } = storeStates[code];
        serializableStates[code] = rest;
    }
    store.put({ key: 'storeStates', value: serializableStates });
    store.put({ key: 'lastUpdated', value: Date.now() });
    
    console.log('Session saved to IndexedDB');
}

async function checkAndRestoreSession() {
    if (!photoDB) return;
    
    const tx = photoDB.transaction(STORE_SESSION, 'readonly');
    const store = tx.objectStore(STORE_SESSION);
    
    const rkmReq = store.get('rkmData');
    const statesReq = store.get('storeStates');
    
    rkmReq.onsuccess = () => {
        const savedRKM = rkmReq.result?.value;
        if (savedRKM) {
             statesReq.onsuccess = () => {
                 const savedStates = statesReq.result?.value;
                 if (savedStates) {
                     console.log('Restoring session...');
                     const userConfirm = confirm('Found saved session from previous run. Restore it?');
                     if (userConfirm) {
                         rkmData = savedRKM;
                         // We rely on processRKMData to re-init, but we want to KEEP the saved states
                         // So allow processRKMData to run but then override with savedStates?
                         // Better: processRKMData resets storeStates.
                         // So we call processRKMData(rkmData) then restore states.
                         
                         processRKMData(rkmData, true); 
                         storeStates = savedStates;

                         // Pastiin data stok manual juga tetep ada
                         console.log('Session restored successfully');

                         renderStoreCards();
                         updateStoresCount(); // Update angka di footer (Siap Upload dll)                         
                         // UI Feedback
                         const statusDiv = document.getElementById('daily-status'); // or any status
                         if (statusDiv) {
                             statusDiv.textContent = 'Session Restored';
                             statusDiv.className = 'header-status success';
                             setTimeout(() => {
                                 statusDiv.className = 'header-status hidden';
                             }, 3000);
                         }
                     } else {
                         // Clear session if user rejects? Use clearSession()
                         clearSession();
                     }
                 }
             };
        }
    };
}

function clearSession() {
    if (!photoDB) return;
    const tx = photoDB.transaction(STORE_SESSION, 'readwrite');
    tx.objectStore(STORE_SESSION).clear();
    console.log('Session cleared');
}

async function fetchExternalStock() {
    try {
        const response = await fetch(STOCK_API_URL);
        const rawData = await response.json();
        
        // Transform array-of-objects into a map for fast lookup
        const transformed = {};
        Object.keys(rawData).forEach(storeCode => {
            const storeStock = {};
            rawData[storeCode].forEach(item => {
                if (item.kodeproduk && Array.isArray(item.kodeproduk)) {
                    item.kodeproduk.forEach(code => {
                        storeStock[code] = {
                            qty: item.stock || 0,
                            namaproduk: item.namaproduk
                        };
                    });
                }
            });
            transformed[storeCode] = storeStock;
        });
        
        externalStockData = transformed;
        console.log('Transformed external stock data loaded');
    } catch (error) {
        console.error('Failed to fetch external stock:', error);
    }
}

// ============================================
// FILE UPLOAD
// ============================================
// File Upload & Tabs setup removed in favor of App Shell Fixed Header



// Load Daily Data (GitHub Actions)
async function loadDailyRKM() {
    const statusDiv = document.getElementById('daily-status');
    const btn = document.querySelector('.app-header .btn-primary');
    
    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span> <span class="mobile-hidden">Loading...</span>';
    statusDiv.className = 'header-status loading';
    statusDiv.textContent = 'Preparing data...';
    
    try {
        // Fetch local file generated by GH Action
        const response = await fetch('./real_data_sample.json?t=' + new Date().getTime()); // Prevent caching
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Daily data not found. Script may not have run yet.');
            }
            throw new Error(`Error loading file: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data || (!data.ListRKMDetail && !data.ListBarang)) {
            throw new Error('Invalid data format in daily file');
        }
        
        statusDiv.className = 'header-status success';
        statusDiv.textContent = '✓ Data loaded successfully!';
        
        // Process data
        processRKMData(data);
        
    } catch (error) {
        console.error('Daily load failed:', error);
        statusDiv.className = 'header-status error';
        statusDiv.textContent = `❌ ${error.message}`;
        
        if (error.message.includes('not found')) {
            alert('Daily Data Not Found!\n\nThe automated script runs at 00:01 WIB.\nIf this is the first time, the file might not exist yet.\nTry "Download from Server" instead.');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">🔄</span> <span class="mobile-hidden">Load</span>';
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            processRKMData(data);
        } catch (err) {
            showUploadStatus('error', 'Error parsing JSON: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function showUploadStatus(type, message) {
    uploadStatus.className = `upload-status ${type}`;
    uploadStatus.textContent = message;
}

// ============================================
// RKM DATA PROCESSING
// ============================================
// ============================================
// RKM DATA PROCESSING
// ============================================
function processRKMData(data, isRestore = false) {
    if (!data.ListRKMDetail || !Array.isArray(data.ListRKMDetail)) {
        showUploadStatus('error', 'Invalid format: ListRKMDetail not found');
        return;
    }
    
    rkmData = data;
    
    if (!isRestore) {
        storeStates = {};
        
        // Initialize state for each store
        data.ListRKMDetail.forEach(store => {
            const storeCode = store.RKMD.KodeCustomer;
            
            // Determine initial status from RKM data
            let initialStatus = 'ready';
            let initialCheckIn = null;
            let initialCheckOut = null;

            // Helper to parse /Date(123...)/ format
            const parseJsonDate = (dateStr) => {
                if (!dateStr) return null;
                const match = dateStr.match(/\/Date\((\d+)\)\//);
                return match ? new Date(parseInt(match[1])) : new Date(dateStr);
            };

            if (store.RKMD.CheckOutTime) {
                initialStatus = 'checked-out';
                initialCheckIn = parseJsonDate(store.RKMD.CheckInTime);
                initialCheckOut = parseJsonDate(store.RKMD.CheckOutTime);
            } else if (store.RKMD.CheckInTime) {
                initialStatus = 'checked-in';
                initialCheckIn = parseJsonDate(store.RKMD.CheckInTime);
            }

            storeStates[storeCode] = {
                storeData: store,
                checkInTime: initialCheckIn,
                checkOutTime: initialCheckOut,
                gpsLat: parseFloat(store.RKMD.Latitude),
                gpsLng: parseFloat(store.RKMD.Longitude),
                photos: { checkin: [], before: [], after: [] },
                stockData: [],
                status: initialStatus,
                isExpanded: false,
                openSection: 'gps',  // default: GPS dulu
                isSynced: !!store.RKMD.CheckOutTime
            };
        });
        
        // Load stock data (initial)
        loadAllStockData();
        
        // Initial Save
        saveSession();
    }
    
    // Render store cards
    renderStoreCards();
    
    // Show success
    showUploadStatus('success', `✓ ${isRestore ? 'Session Restored' : 'Loaded'} (${data.ListRKMDetail.length} stores)`);
    storesContainer.classList.remove('hidden');
    // outputSection.classList.remove('hidden'); // Always visible in footer
    updateStoresCount();
    
    // Auto-collapse upload section removed
}

function loadAllStockData() {
    if (!rkmData.ListRKMStok) return;
    
    // Build product master map from ListBarang
    const productMaster = {};
    if (rkmData.ListBarang && Array.isArray(rkmData.ListBarang)) {
        rkmData.ListBarang.forEach(product => {
            const code = (product.KodeBarang || product.KodeBrg || "").trim();
            if (code) {
                productMaster[code] = product.NamaBrg || product.NamaBarang;
            }
        });
    }
    
    Object.keys(storeStates).forEach(storeCode => {
        let stockItems = rkmData.ListRKMStok.filter(
            item => item.KodeCustomer.trim() === storeCode.trim()
        );
        
        const externalStock = externalStockData[storeCode] || {};
        const tanggalRKM = storeStates[storeCode]?.storeData?.RKMD?.TanggalRKM || new Date().toISOString();
        const kodeMDS = storeStates[storeCode]?.storeData?.RKMD?.KodeMerchandiser || '';

        // FALLBACK: Kalau RPS tidak punya daftar stok untuk toko ini,
        // generate dari live_stock.json supaya stok bisa ke-upload
        if (stockItems.length === 0 && Object.keys(externalStock).length > 0) {
            console.log(`[FALLBACK] Toko ${storeCode} tidak ada di ListRKMStok, generate dari live_stock...`);
            stockItems = Object.entries(externalStock)
                .filter(([code]) => code !== 'N/A')
                .map(([code, data]) => ({
                    KodeCustomer: storeCode,
                    KodeBarang: code,
                    NamaBrg: data.namaproduk || code,
                    JumKarton: 0,
                    JumSatuan: data.qty || 0,
                    JumPcsE: 0,
                    TanggalRKM: tanggalRKM,
                    KodeMerchandiser: kodeMDS,
                }));
        } else {
            // Normal flow: update qty dari live_stock ke item RPS
            stockItems.forEach(item => {
                const itemCode = (item.KodeBarang || item.KodeBrg || "").trim();
                
                // Get product name from master list (ListBarang)
                if (productMaster[itemCode]) {
                    item.NamaBrg = productMaster[itemCode];
                }
                
                const extData = externalStock[itemCode];
                if (extData) {
                    // IMPORTANT: Map external qty to JumSatuan (Display) instead of JumPcsE (Expired)
                    item.JumSatuan = extData.qty;
                    item.JumPcsE = 0;
                }
            });
        }
        
        storeStates[storeCode].stockData = stockItems;
    });
}

function updateManualStock(storeCode, itemCode, newValue) {
    const state = storeStates[storeCode];
    const qty = parseInt(newValue) || 0;

    // Update in state.stockData
    const itemIndex = state.stockData.findIndex(i => (i.KodeBarang || i.KodeBrg || "").trim() === itemCode.trim());
    if (itemIndex !== -1) {
        state.stockData[itemIndex].JumSatuan = qty;
        console.log(`[STOK] ${storeCode} - ${itemCode} updated to: ${qty}`);
        
        // Save to session so it persists refresh
        saveSession();
    }
}

function reOpenStore(storeCode) {
    if (!confirm('Buka kuncian toko ini buat diedit/re-upload lagi?')) return;
    
    const state = storeStates[storeCode];
    state.status = 'checked-in'; // Balikin status ke checked-in biar tombol OUT muncul lagi
    state.isSynced = false;      // Biar dia masuk hitungan "Siap Upload" lagi
    
    refreshStoreCard(storeCode);
    updateStoresCount();
    saveSession();
}

// ============================================
// STORE CARD RENDERING
// ============================================
function renderStoreCards() {
    storesContainer.innerHTML = '';
    const allStoreCodes = Object.keys(storeStates);

    // Filter toko jadi 3 grup sesuai progres
    const pendingStores = allStoreCodes.filter(code => {
        const s = storeStates[code];
        return !s.isSynced && s.status !== 'checked-out';
    });
    
    const readyToUploadStores = allStoreCodes.filter(code => {
        const s = storeStates[code];
        return !s.isSynced && s.status === 'checked-out';
    });

    const syncedStores = allStoreCodes.filter(code => storeStates[code].isSynced);

    // 1. Render Grup: BELUM DIKERJAKAN
    if (pendingStores.length > 0) {
        const header = document.createElement('div');
        header.className = 'stores-group-header';
        header.innerHTML = `<span>⏳ BELUM DIKERJAKAN (${pendingStores.length})</span>`;
        storesContainer.appendChild(header);

        pendingStores.forEach(storeCode => {
            const card = createStoreCard(storeCode, storeStates[storeCode]);
            storesContainer.appendChild(card);
        });
    }

    // 2. Render Grup: SIAP UPLOAD
    if (readyToUploadStores.length > 0) {
        const header = document.createElement('div');
        header.className = 'stores-group-header ready-header';
        header.innerHTML = `<span>🚀 SIAP UPLOAD (${readyToUploadStores.length})</span>`;
        storesContainer.appendChild(header);

        readyToUploadStores.forEach(storeCode => {
            const card = createStoreCard(storeCode, storeStates[storeCode]);
            storesContainer.appendChild(card);
        });
    }

    // 3. Render Grup: SUDAH TERUPLOAD
    if (syncedStores.length > 0) {
        const header = document.createElement('div');
        header.className = 'stores-group-header completed-header';
        header.innerHTML = `<span>✅ SUDAH TERUPLOAD (${syncedStores.length})</span>`;
        storesContainer.appendChild(header);

        syncedStores.forEach(storeCode => {
            const card = createStoreCard(storeCode, storeStates[storeCode]);
            storesContainer.appendChild(card);
        });
    }
}
function createStoreCard(storeCode, state) {
    const card = document.createElement('div');
    card.className = `store-card ${state.status === 'checked-out' ? 'store-locked' : ''}`;
    card.dataset.storeCode = storeCode;
    
    // Get validation status
    const validation = validateStoreCompleteness(storeCode);
    
    // Determine single consolidated badge
    let badgeClass, badgeIcon, badgeText;
    
    // Priority 1: Server Status (Checked Out)
    if (state.status === 'checked-out') {
        if (state.isSynced) {
            badgeClass = 'completeness-complete';
            badgeIcon = '☁️';
            badgeText = 'Terupload';
        } else {
            badgeClass = 'completeness-complete';
            badgeIcon = '✓';
            badgeText = 'Siap Upload';
        }
    } 
    // Priority 2: Server Status (Checked In)
    else if (state.status === 'checked-in') {
        badgeClass = 'completeness-warning';
        badgeIcon = '⏳';
        badgeText = 'Sedang Isi';
    } 
    // Priority 3: Local Validation (Incomplete)
    else if (!validation.isComplete) {
        badgeClass = 'completeness-incomplete';
        badgeIcon = '⚠';
        badgeText = 'Belum Lengkap';
    } 
    // Priority 4: Default (Not Started)
    else {
        badgeClass = 'status-ready';
        badgeIcon = '○';
        badgeText = 'Belum Mulai';
    }
    
    const storeName = state.storeData.RKMD?.NamaCustomer || state.storeData.NamaCustomer || storeCode;
    
    card.innerHTML = `
        <div class="store-header" onclick="toggleStoreCard('${storeCode}')">
            <img src="icons/store-icon.jpg" class="store-icon" alt="store">
            <div class="store-details">
                <div class="store-name">${storeName}</div>
                <div class="store-header-bottom">
                    <span class="store-code">${storeCode}</span>
                    <span class="completeness-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
                    ${state.isSynced ? `<button class="btn-reupload" onclick="event.stopPropagation(); reOpenStore('${storeCode}')">✏️ Edit & Re-Upload</button>` : ''}
                </div>
            </div>
            <span class="expand-icon">▼</span>
        </div>
        <div class="store-body">
            <div class="store-content">
                <!-- ${renderValidationSection(storeCode, state)} -->
                ${renderGPSSection(storeCode, state)}
                ${renderTimelineSection(storeCode, state)}
                ${renderStockSection(storeCode, state)}
            </div>
        </div>
    `;
    
    return card;
}

// ============================================
// RENDER SECTIONS
// ============================================
function renderValidationSection(storeCode, state) {
    const validation = validateStoreCompleteness(storeCode);
    
    // Determine summary text
    let summaryText = '';
    let summaryClass = '';
    if (validation.isComplete) {
        summaryText = 'Complete';
        summaryClass = 'text-success';
        if (validation.hasWarnings) {
            summaryText = `Complete (${validation.warnings.length} Warnings)`;
            summaryClass = 'text-warning';
        }
    } else {
        const count = validation.issues.length;
        summaryText = `${count} Missing Item${count > 1 ? 's' : ''}`;
        summaryClass = 'text-error';
    }

    return `
        <div class="card-section validation-section">
            <div class="validation-header" onclick="event.stopPropagation(); toggleValidation(this)">
                <div class="card-section-title" style="margin:0">📋 Data Validation</div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="validation-summary ${summaryClass}">${summaryText}</span>
                    <span class="validation-toggle-icon">▼</span>
                </div>
            </div>
            
            <div class="validation-content">
                <div class="validation-checklist">
                    ${renderValidationItem('Check-In completed', !state.checkInTime)}
                    ${renderValidationItem('Check-Out completed', !state.checkOutTime)}
                    ${renderValidationItem(`Check-in photo (${state.photos.checkin.length}/1)`, state.photos.checkin.length !== 1)}
                    ${renderValidationItem(`Before photos (${state.photos.before.length})`, state.photos.before.length < 1)}
                    ${renderValidationItem(`After photos (${state.photos.after.length})`, state.photos.after.length < 1)}
                    ${renderValidationItem('GPS coordinates set', false)}
                    ${state.stockData.some(item => item.JumSatuan > 0) ? '' : renderWarningItem('No stock data entered')}
                </div>
                ${validation.issues.length > 0 ? `
                    <div class="validation-issues">
                        <strong>⚠ Missing Required Data:</strong>
                        <ul>
                            ${validation.issues.map(i => `<li>${i}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                ${validation.warnings.length > 0 && validation.isComplete ? `
                    <div class="validation-warnings">
                        <strong>⚠ Warnings:</strong>
                        <ul>
                            ${validation.warnings.map(w => `<li>${w}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function renderValidationItem(label, isIncomplete) {
    const icon = isIncomplete ? '✗' : '✓';
    const className = isIncomplete ? 'incomplete' : 'complete';
    return `<div class="validation-item ${className}">${icon} ${label}</div>`;
}

function renderWarningItem(label) {
    return `<div class="validation-item warning">⚠ ${label}</div>`;
}


function renderGPSSection(storeCode, state) {
    const isReadOnly = state.status === 'checked-out';
    const disabledAttr = isReadOnly ? 'disabled' : '';
    
    // Validation: Check if still default
    const defaultLat = state.storeData.RKMD.Latitude;
    const defaultLng = state.storeData.RKMD.Longitude;
    const isGPSValid = state.gpsLat !== parseFloat(defaultLat) || state.gpsLng !== parseFloat(defaultLng);
    const validClass = isGPSValid ? '' : 'section-incomplete';

    const open = (state.openSection === 'gps');

    return `
        <div class="card-section">
            <div class="section-accordion-title" onclick="toggleSection('${storeCode}', 'gps')">
                <span>📍 GPS Coordinates
                    ${!isGPSValid ? '<span class="section-warning-icon">⚠</span>' : '<span class="section-ok-icon">✅</span>'}
                </span>
                <span class="section-chevron ${open ? '' : 'collapsed'}">▾</span>
            </div>
            <div class="section-accordion-body ${open ? '' : 'collapsed'}">
                <div class="gps-combined-row">
                    <div class="gps-input-group">
                        <input 
                            type="text"
                            class="gps-combined-input"
                            data-gps-combined="${storeCode}"
                            value="${state.gpsLat}, ${state.gpsLng}" 
                            onchange="updateGPSCombined('${storeCode}', this.value)"
                            placeholder="lat, lon — contoh: -6.123456, 106.123456"
                            ${disabledAttr}>
                        <button 
                            class="gps-inline-btn" 
                            onclick="setManualGPSWithJitter('${storeCode}')" 
                            title="Terapkan koordinat ini + sedikit geser acak"
                            ${disabledAttr}>
                            🎯 Set+Jitter
                        </button>
                    </div>
                </div>
                <div class="gps-controls">
                    <button class="btn-secondary" onclick="useDeviceGPS('${storeCode}')" ${disabledAttr}>
                        📡 Use My GPS
                    </button>
                    <button class="btn-secondary" onclick="addJitter('${storeCode}')" ${disabledAttr}>
                        Geser Sedikit 📌
                    </button>
                </div>
                <div id="map-${storeCode}" class="store-map"></div>
            </div>
        </div>
    `;
}

// Helper: Enter to Tab Navigation (Enhanced for Android)
window.handleEnterAsTab = function(e) {
    // Nangkep Enter (13) atau Next (Android Action)
    if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        
        // Cari kartu toko (parent) biar navigasi nggak loncat ke toko lain
        const card = e.target.closest('.store-card');
        if (!card) return;

        // Cari semua input/button yang aktif di dalam kartu ini saja
        const selector = 'input:not([type="file"]):not([disabled]), button:not([disabled])';
        const elements = Array.from(card.querySelectorAll(selector)).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
        });
        
        const index = elements.indexOf(e.target);
        
        if (index > -1 && index < elements.length - 1) {
            const nextEl = elements[index + 1];
            nextEl.focus();
            if (nextEl.select && nextEl.tagName === 'INPUT') nextEl.select();
        } else {
            // Selesai di kartu ini, tutup keyboard
            e.target.blur();
        }
    }
};

// Helper: Auto-focus next input after 2 digits
window.autoFocusNext = function(el) {
    if (el.value.length >= 2) {
        const card = el.closest('.store-card');
        if (!card) return;
        
        const selector = 'input:not([type="file"]):not([disabled])';
        const inputs = Array.from(card.querySelectorAll(selector)).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0;
        });
        
        const index = inputs.indexOf(el);
        if (index > -1 && index < inputs.length - 1) {
            const nextInp = inputs[index + 1];
            nextInp.focus();
            if (nextInp.select) nextInp.select();
        }
    }
};

// Map Initialization Logic
function initMap(storeCode) {
    if (!storeStates[storeCode]) return;
    
    const mapId = `map-${storeCode}`;
    const mapEl = document.getElementById(mapId);
    if (!mapEl) return;

    // HAPUS MAP LAMA JIKA ADA (Krusial karena DOM di-refresh oleh refreshStoreCard)
    if (storeStates[storeCode].mapInstance) {
        try {
            storeStates[storeCode].mapInstance.remove();
        } catch (e) {
            console.warn("Gagal remove map:", e);
        }
        storeStates[storeCode].mapInstance = null;
        storeStates[storeCode].userMarker = null;
    }

    // Pastikan kontainer bersih
    mapEl.innerHTML = '';

    // Default coords: Store Location or Default Jakarta
    const storeLat = parseFloat(storeStates[storeCode].storeData.RKMD.Latitude) || -6.2088;
    const storeLng = parseFloat(storeStates[storeCode].storeData.RKMD.Longitude) || 106.8456;
    
    // User coords: Current Input or Store Location
    let userLat = parseFloat(storeStates[storeCode].gpsLat) || storeLat;
    let userLng = parseFloat(storeStates[storeCode].gpsLng) || storeLng;

    // Init Map
    const map = L.map(mapId).setView([userLat, userLng], 15);
    
    // Add Tiles (OSM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Store Marker (Default Blue Pin)
    const storeName = storeStates[storeCode].storeData.RKMD.NamaCustomer || storeCode;
    L.marker([storeLat, storeLng]).addTo(map)
        .bindTooltip(`📍 ${storeName}`, {permanent: true, direction: 'right', className: 'map-label-store'});

    // User Marker (Red Pin - Draggable)
    const isReadOnly = storeStates[storeCode].status === 'checked-out';
    
    const redIcon = new L.Icon({
        iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });
    const userMarker = L.marker([userLat, userLng], {draggable: !isReadOnly, icon: redIcon}).addTo(map)
        .bindTooltip('🎯 Lokasi Kamu (Tarik)', {permanent: true, direction: 'left', className: 'map-label-spoof'});

    // Event: Drag User Marker
    userMarker.on('dragend', function(e) {
        const {lat, lng} = e.target.getLatLng();
        updateGPS(storeCode, 'lat', lat.toFixed(6));
        updateGPS(storeCode, 'lng', lng.toFixed(6));
        syncGPSUI(storeCode);
    });

    // Event: Map Click (Teleport)
    map.on('click', function(e) {
        if (isReadOnly) return;
        userMarker.setLatLng(e.latlng);
        updateGPS(storeCode, 'lat', e.latlng.lat.toFixed(6));
        updateGPS(storeCode, 'lng', e.latlng.lng.toFixed(6));
        syncGPSUI(storeCode);
    });

    // Save instance
    storeStates[storeCode].mapInstance = map;
    storeStates[storeCode].userMarker = userMarker;

    // Pastikan ukuran map pas (untuk layar HP)
    setTimeout(() => {
        map.invalidateSize();
    }, 150);
}

function renderTimelineSection(storeCode, state) {
    const isReadOnly = state.status === 'checked-out';
    const disabledAttr = isReadOnly ? 'disabled' : '';

    const isComplete = state.checkInTime && state.checkOutTime;
    const validClass = isComplete ? '' : 'section-incomplete';

    const checkInDisabled  = isReadOnly || state.status !== 'ready';
    const checkOutDisabled = isReadOnly || state.status !== 'checked-in';

    // Photo helpers
    const photos = state.photos;
    const isPhotoComplete = photos.checkin.length >= 1 &&
                            photos.before.length  >= 1 &&
                            photos.after.length   >= 1;
    const photoDisabled = isReadOnly ? 'disabled' : '';

    // Format stored timestamps ke HH:mm
    const fmtTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    const renderThumbnails = (arr) => arr.length === 0 ? '' : `
        <div class="photo-thumbnail-grid">
            ${arr.map(p => `<img src="${p.thumbnail}" class="photo-thumbnail" alt="foto" />`).join('')}
        </div>`;


    const open = (state.openSection === 'timeline');

    return `
        <div class="card-section ${validClass}">
            <div class="section-accordion-title" onclick="toggleSection('${storeCode}', 'timeline')">
                <span>⏰ Visit Timeline
                    ${!isComplete ? '<span class="section-warning-icon">⚠</span>' : '<span class="section-ok-icon">✅</span>'}
                </span>
                <span class="section-chevron ${open ? '' : 'collapsed'}">▾</span>
            </div>
            <div class="section-accordion-body ${open ? '' : 'collapsed'}">

            <div class="timeline-simple">
                <!-- CHECK IN ROW -->
                <div class="timeline-simple-row">
                    <div class="timeline-time-block">
                        <label class="timeline-simple-label">In <small style="font-size: 8px; opacity: 0.5;">(24h)</small></label>
                        <input type="text" class="time-input-simple time-input-hh time-input-checkin-hh" placeholder="HH" inputmode="numeric" maxlength="2" value="${fmtTime(state.checkInTime).split(':')[0] || ''}" ${checkInDisabled ? 'disabled' : ''} onkeydown="handleEnterAsTab(event)" onkeypress="handleEnterAsTab(event)" oninput="autoFocusNext(this)" onfocus="this.select()">
                        <span class="time-input-separator">:</span>
                        <input type="text" class="time-input-simple time-input-mm time-input-checkin-mm" placeholder="mm" inputmode="numeric" maxlength="2" value="${fmtTime(state.checkInTime).split(':')[1] || ''}" ${checkInDisabled ? 'disabled' : ''} onkeydown="handleEnterAsTab(event)" onkeypress="handleEnterAsTab(event)" onfocus="this.select()">
                    </div>
                    <button
                        class="btn-checkin"
                        onclick="handleCheckIn('${storeCode}')"
                        ${checkInDisabled ? 'disabled' : ''}>
                        ${state.checkInTime ? '✅ ' + fmtTime(state.checkInTime) : '▶ IN'}
                    </button>
                </div>

                <!-- PHOTO UPLOAD (di antara IN dan OUT) -->
                <div class="timeline-photo-block ${isPhotoComplete ? 'photo-complete' : ''}">
                    <div class="timeline-photo-title">
                        📸 Foto ${isPhotoComplete ? '✅' : '<span class="section-warning-icon">⚠</span>'}
                    </div>
                    <div class="timeline-photo-grid">
                        <div class="timeline-photo-item">
                            <label class="timeline-photo-label">Check-In</label>
                            <label class="custom-file-btn" ${isReadOnly ? 'style="opacity:.4;pointer-events:none;"' : ''}>
                                <span style="font-size: 1.5rem;">📷</span>
                                <span>${photos.checkin.length > 0 ? photos.checkin.length + ' foto' : 'Pilih'}</span>
                                <input type="file" accept="image/*" onchange="handlePhotoUpload('${storeCode}', 'checkin', this.files, 1)" ${photoDisabled} hidden>
                            </label>
                            ${renderThumbnails(photos.checkin)}
                        </div>
                        <div class="timeline-photo-item">
                            <label class="timeline-photo-label">Before</label>
                            <label class="custom-file-btn" ${isReadOnly ? 'style="opacity:.4;pointer-events:none;"' : ''}>
                                <span style="font-size: 1.5rem;">📷</span>
                                <span>${photos.before.length > 0 ? photos.before.length + ' foto' : 'Pilih'}</span>
                                <input type="file" accept="image/*" multiple onchange="handlePhotoUpload('${storeCode}', 'before', this.files, 20)" ${photoDisabled} hidden>
                            </label>
                            ${renderThumbnails(photos.before)}
                        </div>
                        <div class="timeline-photo-item">
                            <label class="timeline-photo-label">After</label>
                            <label class="custom-file-btn" ${isReadOnly ? 'style="opacity:.4;pointer-events:none;"' : ''}>
                                <span style="font-size: 1.5rem;">📷</span>
                                <span>${photos.after.length > 0 ? photos.after.length + ' foto' : 'Pilih'}</span>
                                <input type="file" accept="image/*" multiple onchange="handlePhotoUpload('${storeCode}', 'after', this.files, 20)" ${photoDisabled} hidden>
                            </label>
                            ${renderThumbnails(photos.after)}
                        </div>
                    </div>
                </div>

                <!-- CHECK OUT ROW -->
                <div class="timeline-simple-row">
                    <div class="timeline-time-block">
                        <label class="timeline-simple-label">Out <small style="font-size: 8px; opacity: 0.5;">(24h)</small></label>
                        <input type="text" class="time-input-simple time-input-hh time-input-checkout-hh" placeholder="HH" inputmode="numeric" maxlength="2" value="${fmtTime(state.checkOutTime).split(':')[0] || ''}" ${checkOutDisabled ? 'disabled' : ''} onkeydown="handleEnterAsTab(event)" oninput="autoFocusNext(this)" onfocus="this.select()">
                        <span class="time-input-separator">:</span>
                        <input type="text" class="time-input-simple time-input-mm time-input-checkout-mm" placeholder="mm" inputmode="numeric" maxlength="2" value="${fmtTime(state.checkOutTime).split(':')[1] || ''}" ${checkOutDisabled ? 'disabled' : ''} onkeydown="handleEnterAsTab(event)" onfocus="this.select()">
                    </div>
                    <button
                        class="btn-checkout"
                        onclick="handleCheckOut('${storeCode}')"
                        ${checkOutDisabled ? 'disabled' : ''}>
                        ${state.checkOutTime ? '✅ ' + fmtTime(state.checkOutTime) : '⏹ OUT'}
                    </button>
                </div>
            </div>
            </div>
        </div>
    `;
}


function renderStockSection(storeCode, state) {
    const open = (state.openSection === 'stock');
    const stockList = state.stockData
        .map(item => {
            const itemCode = (item.KodeBarang || item.KodeBrg || "").trim();
            const qty = item.JumSatuan || 0;
            const name = item.NamaBrg || item.NamaBarang || 'Unknown Product';
            const qtyColor = qty > 0 ? '#3fb950' : '#f85149'; // Green for stock, red for empty
            
            return `
            <div class="stock-item">
                <span class="stock-name">${itemCode} - ${name}</span>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <input type="number"
                           class="manual-stock-input"
                           style="width: 50px; text-align: center; border-radius: 6px; border: 1px solid var(--border-default); background: var(--bg-tertiary); color: ${qtyColor}; font-weight: ${qty > 0 ? 'bold' : 'normal'}; padding: 2px 4px; font-size: 13px;"
                           value="${qty}"
                           min="0"
                           inputmode="numeric"
                           onchange="updateManualStock('${storeCode}', '${itemCode}', this.value)"
                           onkeydown="handleEnterAsTab(event)"
                           onkeypress="handleEnterAsTab(event)"
                           ${state.isSynced ? 'disabled' : ''}>                    <span style="font-size: 11px; color: var(--text-secondary);">pcs</span>
                </div>
            </div>
        `;
        })
        .join('');
    
    return `
        <div class="card-section">
            <div class="section-accordion-title" onclick="toggleSection('${storeCode}', 'stock')">
                <span>📦 Stock Opname (${state.stockData.length} items)</span>
                <span class="section-chevron ${open ? '' : 'collapsed'}">▾</span>
            </div>
            <div class="section-accordion-body ${open ? '' : 'collapsed'}">
                <div class="stock-list">
                    ${stockList || '<p style="color: var(--text-muted); text-align: center;">No items found in RKM</p>'}
                </div>
            </div>
        </div>
    `;
}

// Update nilai stok hasil editan manual
window.updateManualStock = function(storeCode, itemCode, val) {
    const state = storeStates[storeCode];
    if (!state || state.isSynced) return;
    
    const item = state.stockData.find(i => (i.KodeBarang || i.KodeBrg || '').trim() === itemCode);
    if (item) {
        item.JumSatuan = parseInt(val) || 0;
        saveSession();
        // Skip calling refreshStoreCard here otherwise the input loses focus while typing! 
        // Just update state dynamically. We change the text color directly on the input element if we want,
        // but just updating state is enough.
    }
};

// Toggle section accordion per store
function toggleSection(storeCode, section) {
    const state = storeStates[storeCode];
    // Kalau diklik yang sama → tutup (set null), kalau beda → buka yang baru
    state.openSection = state.openSection === section ? null : section;
    refreshStoreCard(storeCode);
    // Re-init map kalau gps dibuka
    if (state.openSection === 'gps') {
        setTimeout(() => initMap(storeCode), 150);
    }
}

// Auto advance: GPS selesai → pindah ke timeline
function autoAdvanceSection(storeCode) {
    const state = storeStates[storeCode];
    if (state.openSection === 'gps') {
        state.openSection = 'timeline';
        refreshStoreCard(storeCode);
    }
}


window.toggleStoreCard = function(storeCode) {
    const state = storeStates[storeCode];
    // if (state.status === 'checked-out') return; // Allow expansion for Read-Only view

    const card = document.querySelector(`[data-store-code="${storeCode}"]`);
    const isExpanded = card.classList.contains('expanded');
    
    // Collapse all other cards first (Accordion style)
    document.querySelectorAll('.store-card.expanded').forEach(c => {
        if (c !== card) c.classList.remove('expanded');
    });

    if (isExpanded) {
        card.classList.remove('expanded');
        state.isExpanded = false;
    } else {
        card.classList.add('expanded');
        state.isExpanded = true;
        
        // Initialize Map when expanded
        setTimeout(() => initMap(storeCode), 100);
    }
    
    saveSession();
}


// ============================================
// GPS FUNCTIONS
// ============================================
function updateGPS(storeCode, coord, value) {
    const state = storeStates[storeCode];
    if (coord === 'lat') state.gpsLat = parseFloat(value);
    if (coord === 'lng') state.gpsLng = parseFloat(value);
    
    // Sync Map Marker
    if (state.userMarker) {
        state.userMarker.setLatLng([state.gpsLat, state.gpsLng]);
    }
    
    saveSession();
}

// New: Update GPS from combined "lat, lon" input
function updateGPSCombined(storeCode, value) {
    const parts = value.split(',');
    if (parts.length === 2) {
        const lat = parseFloat(parts[0].trim());
        const lng = parseFloat(parts[1].trim());
        if (!isNaN(lat) && !isNaN(lng)) {
            updateGPS(storeCode, 'lat', lat);
            updateGPS(storeCode, 'lng', lng);
            // Sync map marker + pan
            const state = storeStates[storeCode];
            if (state.userMarker) {
                state.userMarker.setLatLng([lat, lng]);
                if (state.mapInstance) state.mapInstance.panTo([lat, lng]);
            }
        }
    }
}

// New: Use real device GPS + apply jitter
function useDeviceGPS(storeCode) {
    if (!navigator.geolocation) {
        alert('Browser lu tidak support Geolocation bro!');
        return;
    }
    
    // Show loading state on button
    const card = document.querySelector(`[data-store-code="${storeCode}"]`);
    const btn = card?.querySelector('button[onclick*="useDeviceGPS"]');
    if (btn) { btn.disabled = true; btn.textContent = '📡 Detecting...'; }
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const rawLat = pos.coords.latitude;
            const rawLng = pos.coords.longitude;
            const jittered = addGPSJitter(rawLat, rawLng);
            updateGPS(storeCode, 'lat', jittered.lat);
            updateGPS(storeCode, 'lng', jittered.lng);
            syncGPSUI(storeCode);
            autoAdvanceSection(storeCode);
            console.log(`[GPS Real] ${storeCode}: raw=(${rawLat.toFixed(7)}, ${rawLng.toFixed(7)}) → jittered=(${jittered.lat}, ${jittered.lng})`);
            if (btn) { btn.disabled = false; btn.innerHTML = '📡 Use My GPS'; }
        },
        (err) => {
            console.warn('[GPS] Error:', err.message);
            alert(`Gagal dapat GPS: ${err.message}\n\nPastikan izin lokasi sudah diberikan bro.`);
            if (btn) { btn.disabled = false; btn.innerHTML = '📡 Use My GPS'; }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// New: Manual input + jitter — baca nilai dari input field, apply jitter, sync
function setManualGPSWithJitter(storeCode) {
    const card = document.querySelector(`[data-store-code="${storeCode}"]`);
    const input = card?.querySelector(`[data-gps-combined="${storeCode}"]`);
    if (!input) return;
    
    const parts = input.value.split(',');
    if (parts.length !== 2) {
        alert('Format koordinat salah bro! Gunakan: lat, lon\nContoh: -6.123456, 106.123456');
        return;
    }
    
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lng)) {
        alert('Angka koordinat ga valid bro, cek lagi!');
        return;
    }
    
    const jittered = addGPSJitter(lat, lng);
    updateGPS(storeCode, 'lat', jittered.lat);
    updateGPS(storeCode, 'lng', jittered.lng);
    syncGPSUI(storeCode);
    autoAdvanceSection(storeCode);
    console.log(`[GPS Manual+Jitter] ${storeCode}: input=(${lat}, ${lng}) → jittered=(${jittered.lat}, ${jittered.lng})`);
}

function addJitter(storeCode) {
    const state = storeStates[storeCode];
    const jittered = addGPSJitter(state.gpsLat, state.gpsLng);
    state.gpsLat = jittered.lat;
    state.gpsLng = jittered.lng;
    syncGPSUI(storeCode);
    autoAdvanceSection(storeCode);
}

// Helper: Sync combined GPS input field + map marker
function syncGPSUI(storeCode) {
    const state = storeStates[storeCode];
    const card = document.querySelector(`[data-store-code="${storeCode}"]`);
    if (card) {
        const combinedInput = card.querySelector(`[data-gps-combined="${storeCode}"]`);
        if (combinedInput) combinedInput.value = `${state.gpsLat}, ${state.gpsLng}`;
    }
    
    // Sync Map Marker
    if (state.userMarker) {
        state.userMarker.setLatLng([state.gpsLat, state.gpsLng]);
        if (state.mapInstance) {
            state.mapInstance.panTo([state.gpsLat, state.gpsLng]);
        }
    }
    
    saveSession();
}

function addGPSJitter(lat, lng) {
    const jitterMeters = Math.random() * 25 + 5; // 5-30m
    const latOffset = (jitterMeters / 111000) * (Math.random() * 2 - 1);
    const lngOffset = (jitterMeters / (111000 * Math.cos(lat * Math.PI / 180))) * (Math.random() * 2 - 1);
    return {
        lat: parseFloat((lat + latOffset).toFixed(7)),
        lng: parseFloat((lng + lngOffset).toFixed(7))
    };
}

// ============================================
// CHECK-IN/OUT FUNCTIONS
// ============================================

function getBaseDateFromRKM(state) {
    let dateStr = state.storeData?.RKMD?.TanggalRKM;
    if (!dateStr) return new Date();
    const match = dateStr.match(/\/Date\((\d+)\)\//);
    return match ? new Date(parseInt(match[1])) : new Date(dateStr);
}

// toggleTimeInput sudah tidak diperlukan (no more backdate mode)
// Fungsi ini dibiarkan kosong agar tidak error jika masih dipanggil dari session lama
window.toggleTimeInput = function() {};


function handleCheckIn(storeCode) {
    const state = storeStates[storeCode];
    const card = document.querySelector(`[data-store-code="${storeCode}"]`);

    let timeToSet = new Date(); // default: sekarang

    // Cek apakah user ubah jam di input manual (HH:mm)
    if (card) {
        const hhInput = card.querySelector('.time-input-checkin-hh');
        const mmInput = card.querySelector('.time-input-checkin-mm');
        if (hhInput && mmInput && (hhInput.value || mmInput.value)) {
            const h = parseInt(hhInput.value) || 0;
            const m = parseInt(mmInput.value) || 0;
            const randomSec = Math.floor(Math.random() * 60);
            timeToSet = new Date();
            timeToSet.setHours(h, m, randomSec, 0);
        }
    }

    state.checkInTime = timeToSet;
    state.status = 'checked-in';
    refreshStoreCard(storeCode);
    updateStoresCount();
    saveSession();
}

function handleCheckOut(storeCode) {
    const state = storeStates[storeCode];
    const card = document.querySelector(`[data-store-code="${storeCode}"]`);

    let timeToSet = new Date(); // default: sekarang

    // Cek apakah user ubah jam di input manual (HH:mm)
    if (card) {
        const hhInput = card.querySelector('.time-input-checkout-hh');
        const mmInput = card.querySelector('.time-input-checkout-mm');
        if (hhInput && mmInput && (hhInput.value || mmInput.value)) {
            const h = parseInt(hhInput.value) || 0;
            const m = parseInt(mmInput.value) || 0;
            const randomSec = Math.floor(Math.random() * 60);
            timeToSet = new Date();
            timeToSet.setHours(h, m, randomSec, 0);
        }
    }

    if (timeToSet <= state.checkInTime) {
        alert('Jam Check-Out harus setelah Check-In bro!');
        return;
    }

    // Tampilkan modal konfirmasi dulu
    showCheckoutModal(storeCode, timeToSet);
}

// ============================================
// CHECKOUT CONFIRMATION MODAL
// ============================================
let _pendingCheckout = { storeCode: null, timeToSet: null, mapInstance: null };

function showCheckoutModal(storeCode, timeToSet) {
    const state = storeStates[storeCode];
    _pendingCheckout = { storeCode, timeToSet, mapInstance: null };

    const fmtFull = (ts) => {
        if (!ts) return '—';
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    const fmtDuration = (ms) => {
        const m = Math.round(ms / 60000);
        return m >= 60 ? `${Math.floor(m/60)}j ${m%60}m` : `${m} menit`;
    };

    const rawName = state.storeData.NamaCustomer || state.storeData.RKMD.NamaCustomer || 'Unknown Store';
    const storeTitle = `[${storeCode}] ${rawName}`;
    
    document.getElementById('modal-store-name').textContent   = storeTitle;
    document.getElementById('modal-gps-val').textContent      = `${state.gpsLat.toFixed(5)}, ${state.gpsLng.toFixed(5)}`;
    document.getElementById('modal-checkin-val').textContent  = fmtFull(state.checkInTime);
    document.getElementById('modal-checkout-val').textContent = fmtFull(timeToSet);
    document.getElementById('modal-duration-val').textContent = fmtDuration(timeToSet - state.checkInTime);

    // Stok kosong
    const emptyItems  = state.stockData.filter(i => (i.JumSatuan || 0) === 0);
    const stockListEl  = document.getElementById('modal-stock-list');
    const stockTitleEl = document.getElementById('modal-stock-title');

    if (emptyItems.length === 0) {
        stockTitleEl.innerHTML = '📦 Stok <span style="color:#3fb950">✅ Semua terisi</span>';
        stockListEl.innerHTML  = '';
    } else {
        stockTitleEl.innerHTML = `📦 Stok Kosong <span style="color:#f85149">(${emptyItems.length} item)</span>`;
        stockListEl.innerHTML  = emptyItems.map(i =>
            `<div class="modal-stock-item">
                <span class="modal-item-code">${(i.KodeBarang || i.KodeBrg || '').trim()}</span>
                <span class="modal-item-name">${i.NamaBrg || i.NamaBarang || 'Unknown'}</span>
                <span class="modal-item-qty zero">0 pcs</span>
            </div>`
        ).join('');
    }

    // Tampilkan modal
    const modal = document.getElementById('checkout-modal');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Init Leaflet mini map setelah modal visible
    setTimeout(() => {
        const mapEl = document.getElementById('checkout-modal-map');
        if (_pendingCheckout.mapInstance) {
            _pendingCheckout.mapInstance.remove();
            _pendingCheckout.mapInstance = null;
        }
        mapEl.innerHTML = '';

        const storeLat = parseFloat(state.storeData.RKMD.Latitude);
        const storeLng = parseFloat(state.storeData.RKMD.Longitude);
        const userLat  = state.gpsLat;
        const userLng  = state.gpsLng;

        const map = L.map('checkout-modal-map', { zoomControl: true, attributionControl: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

        L.marker([storeLat, storeLng]).addTo(map)
            .bindTooltip(`🏪 ${storeTitle}`, { permanent: true, direction: 'right', className: 'map-label-store' });

        const redIcon = new L.Icon({
            iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25,41], iconAnchor: [12,41], shadowSize: [41,41]
        });
        L.marker([userLat, userLng], { icon: redIcon }).addTo(map)
            .bindTooltip('🎯 Lokasi Kamu', { permanent: true, direction: 'left', className: 'map-label-spoof' });

        map.fitBounds(L.latLngBounds([[storeLat, storeLng],[userLat, userLng]]), { padding: [30, 30] });
        _pendingCheckout.mapInstance = map;
    }, 120);
}

function confirmCheckout() {
    const { storeCode, timeToSet, mapInstance } = _pendingCheckout;
    if (!storeCode) return;
    if (mapInstance) { mapInstance.remove(); _pendingCheckout.mapInstance = null; }

    const state = storeStates[storeCode];
    state.checkOutTime = timeToSet;
    state.status = 'checked-out';
    state.isExpanded = false; // AUTO COLLAPSE
    
    renderStoreCards(); // Refresh seluruh list agar pindah grup
    updateStoresCount();
    saveSession();

    closeCheckoutModal();
}

function cancelCheckout() {
    const { mapInstance } = _pendingCheckout;
    if (mapInstance) { mapInstance.remove(); _pendingCheckout.mapInstance = null; }
    closeCheckoutModal();
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal').classList.add('hidden');
    document.body.style.overflow = '';
    _pendingCheckout = { storeCode: null, timeToSet: null, mapInstance: null };
}

function handleModalOverlayClick(event) {
    if (event.target.id === 'checkout-modal') cancelCheckout();
}

// ============================================
// PHOTO UPLOAD
// ============================================
async function handlePhotoUpload(storeCode, category, files, maxFiles) {
    const filesArray = Array.from(files).slice(0, maxFiles);
    const state = storeStates[storeCode];
    
    const processedPhotos = [];
    for (const file of filesArray) {
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
    
    state.photos[category] = processedPhotos;
    refreshStoreCard(storeCode);
    saveSession();
}


// ============================================
// PAYLOAD GENERATION
// ============================================
function setupPayloadGeneration() {
    btnUpload.addEventListener('click', handleDualApiUpload);
}



function formatLocalISO(date) {
    if (!date) return null;
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, -1);
    return localISOTime;
}

function buildPayload(storeCode, state) {
    const stockData = state.stockData
        .map(item => ({
            ...item,
            JumKarton: 0,
            JumPcsE: 0, // Ensure expired is strictly 0
            TanggalRKM: item.TanggalRKM || formatLocalISO(new Date())
        }));
    
    return {
        RKMDetail: {
            ...state.storeData.RKMD,
            CheckInTime: formatLocalISO(state.checkInTime),
            CheckOutTime: formatLocalISO(state.checkOutTime),
            CheckInLatitude: state.gpsLat,
            CheckInLongitude: state.gpsLng,
            CheckOutLatitude: state.gpsLat,
            CheckOutLongitude: state.gpsLng
        },
        ListPicHeader: [], // Photos uploaded separately via /uploadpict
        ListRKMDStok: stockData,
        ListOrder: [],
        ListJualH: [],
        ListJualD: []
    };
}

function buildPhotoPayload(storeCode, state) {
    const picHeaders = [];
    const { checkInTime, checkOutTime, gpsLat, gpsLng, storeData } = state;
    
    // Check-in photos
    state.photos.checkin.forEach(photo => {
        picHeaders.push({
            PictureContent: photo.base64.split(',')[1] || '',
            PictureThumbnail: photo.thumbnail.split(',')[1] || '',
            Latitude: gpsLat,
            Longitude: gpsLng,
            GroupCode: '001       ',
            PictureTime: formatLocalISO(checkInTime),
            PictureMemo: '',
            TanggalRKM: storeData.RKMD.TanggalRKM || formatLocalISO(new Date()).split('T')[0],
            KodeMerchandiser: storeData.RKMD.KodeMerchandiser || '',
            KodeCustomer: storeCode,
            CheckInTime: formatLocalISO(checkInTime),
            Location: storeData.RKMD.NamaToko || '',
            PictureCode: '',
            UserCode: ''
        });
    });
    
    // Before photos (1-2 min after check-in)
    state.photos.before.forEach(photo => {
        const photoTime = new Date(checkInTime.getTime() + (Math.random() * 60000 + 60000));
        picHeaders.push({
            PictureContent: photo.base64.split(',')[1] || '',
            PictureThumbnail: photo.thumbnail.split(',')[1] || '',
            Latitude: gpsLat,
            Longitude: gpsLng,
            GroupCode: '002       ',
            PictureTime: formatLocalISO(photoTime),
            PictureMemo: '',
            TanggalRKM: storeData.RKMD.TanggalRKM || formatLocalISO(new Date()).split('T')[0],
            KodeMerchandiser: storeData.RKMD.KodeMerchandiser || '',
            KodeCustomer: storeCode,
            CheckInTime: formatLocalISO(checkInTime),
            Location: storeData.RKMD.NamaToko || '',
            PictureCode: '',
            UserCode: ''
        });
    });
    
    // After photos (1-2 min before check-out)
    state.photos.after.forEach(photo => {
        const photoTime = new Date(checkOutTime.getTime() - (Math.random() * 60000 + 60000));
        picHeaders.push({
            PictureContent: photo.base64.split(',')[1] || '',
            PictureThumbnail: photo.thumbnail.split(',')[1] || '',
            Latitude: gpsLat,
            Longitude: gpsLng,
            GroupCode: '003       ',
            PictureTime: formatLocalISO(photoTime),
            PictureMemo: '',
            TanggalRKM: storeData.RKMD.TanggalRKM || formatLocalISO(new Date()).split('T')[0],
            KodeMerchandiser: storeData.RKMD.KodeMerchandiser || '',
            KodeCustomer: storeCode,
            CheckInTime: formatLocalISO(checkInTime),
            Location: storeData.RKMD.NamaToko || '',
            PictureCode: '',
            UserCode: ''
        });
    });
    
    return picHeaders;
}

// ============================================
// DUAL-API UPLOAD LOGIC
// ============================================
async function handleDualApiUpload() {
    // Only upload stores that are checked-out AND NOT yet synced/uploaded
    const activeStores = Object.keys(storeStates).filter(code => 
        storeStates[code].status === 'checked-out' && !storeStates[code].isSynced
    );
    
    if (activeStores.length === 0) {
        alert('No new completed stores to upload.\n(Already synced stores are skipped)');
        return;
    }

    if (!confirm(`Ready to upload ${activeStores.length} NEW stores to server?`)) {
        return;
    }

    // Reset UI
    uploadProgress.innerHTML = `
        <div class="upload-item" id="global-prog">
            <div class="upload-label">
                <span id="global-prog-label">🚀 Menyiapkan upload...</span>
                <span id="global-prog-percentage">0%</span>
            </div>
            <div class="upload-bar-container">
                <div class="upload-bar" id="global-prog-bar" style="width: 0%"></div>
            </div>
            <div class="upload-status-text" id="global-prog-text">Pending...</div>
        </div>
    `;
    uploadProgress.classList.add('visible');
    uploadProgress.classList.remove('hidden');
    btnUpload.disabled = true;
    btnUpload.innerHTML = '<span class="btn-icon">⏳</span> Uploading...';

    const progBar = document.getElementById('global-prog-bar');
    const progLabel = document.getElementById('global-prog-label');
    const progPct = document.getElementById('global-prog-percentage');
    const progText = document.getElementById('global-prog-text');

    const totalStores = activeStores.length;
    let successStores = 0;
    let hasError = false;
    let lastError = '';

    const updateGlobalStatus = (pct, mainTitle, subDesc) => {
        progBar.style.width = `${pct}%`;
        if (progPct) progPct.textContent = `${Math.round(pct)}%`;
        if (mainTitle) progLabel.textContent = mainTitle;
        if (subDesc) progText.textContent = subDesc;
    };

    // Process each store
    for (let i = 0; i < totalStores; i++) {
        const storeCode = activeStores[i];
        const storeName = storeStates[storeCode].storeData.NamaCustomer || storeStates[storeCode].storeData.RKMD.NamaCustomer || storeCode;
        
        try {
            const basePct = (i / totalStores) * 100;
            const stepPct = 100 / totalStores; // How much % one store takes
            
            updateGlobalStatus(basePct + (stepPct * 0.2), `📤 [${i+1}/${totalStores}] ${storeName}`, 'Mengirim Data kunjungan...');
            await uploadStoreData(storeCode);
            
            const photos = buildPhotoPayload(storeCode, storeStates[storeCode]);
            if (photos.length > 0) {
                let successPhotoCount = 0;
                
                const uploadPromises = photos.map((p, idx) => 
                    uploadPhoto(p).then(() => {
                        successPhotoCount++;
                        const currentStorePhotoPct = (successPhotoCount / photos.length) * (stepPct * 0.8);
                        updateGlobalStatus(basePct + (stepPct * 0.2) + currentStorePhotoPct, null, `Mengirim Foto (${successPhotoCount}/${photos.length})...`);
                    })
                );
                await Promise.all(uploadPromises);
            }
            
            storeStates[storeCode].isSynced = true;
            storeStates[storeCode].status = 'checked-out';
            saveSession(); // CRITICAl: Simpan info sukses upload ke database lokal agar tidak hilang saat direfresh!
            successStores++;
        } catch (error) {
            console.error(`Upload failed for ${storeCode}:`, error);
            hasError = true;
            lastError = error.message;
        }
    }
    
    // Hide UI Progress after complete
    uploadProgress.classList.add('hidden');
    renderStoreCards();
    
    // Show Modal
    showUploadModalResult(successStores, totalStores, hasError, lastError);

    btnUpload.disabled = false;
    btnUpload.innerHTML = '<span class="btn-icon">🚀</span> Upload to Server';
    updateStoresCount(); // refresh disabled/enabled state
}

function showUploadModalResult(successCount, totalCount, hasError, errorMessage) {
    const modal = document.getElementById('upload-modal');
    const title = document.getElementById('upload-modal-title');
    const msg = document.getElementById('upload-modal-message');
    const icon = document.getElementById('upload-modal-icon');

    if (hasError && successCount === 0) {
        title.textContent = "Yah, Gagal!";
        title.style.color = "#ef4444";
        msg.textContent = errorMessage || "Bermasalah saat mengunggah ke server.";
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" class="animate-bounce" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else if (hasError && successCount > 0) {
        title.textContent = "Selesai!";
        title.style.color = "#f59e0b";
        msg.textContent = `${successCount} Toko beres, tapi ada ${totalCount - successCount} toko yang gagal bro.`;
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else {
        title.textContent = "Mantap!";
        title.style.color = "#10b981";
        msg.textContent = `${successCount} Toko berhasil di-upload dengan selamat!`;
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    }

    modal.classList.remove('hidden');
}

function closeUploadModal() {
    document.getElementById('upload-modal').classList.add('hidden');
}

async function uploadStoreData(storeCode) {
    const payload = buildPayload(storeCode, storeStates[storeCode]);
    
    if (MOCK_UPLOAD) {
        console.log(`[MOCK] Uploading RKM Data for ${storeCode}:`, payload);
        // Verify payload here
        if (payload.ListPicHeader && payload.ListPicHeader.length > 0) {
            console.error('❌ ERROR: ListPicHeader should be empty in RKM Upload!');
        } else {
            console.log('✅ Payload check: ListPicHeader is empty.');
        }
        return new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
    }
    
    // Gunakan Cloudflare Workers Proxy buatan sendiri untuk ngakalin CORS
    const response = await fetch('https://cimory-proxy.yohandi-pratama.workers.dev/api/sfaservice/checkoutpostlater', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    // Read and log the actual response body from the server
    const responseText = await response.text();
    console.log(`[POST LATER RESPONSE Code: ${response.status}]:`, responseText);

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${responseText}`);
    }
    
    let result;
    try {
        result = JSON.parse(responseText);
    } catch(e) {
        result = responseText;
    }
    // Check backend response structure? "Status": "success"?
    // Android checks boolean valid.
    return result;
}

async function uploadPhoto(photoPayload) {
    if (MOCK_UPLOAD) {
        console.log(`[MOCK] Uploading Photo (${photoPayload.GroupCode}):`, photoPayload);
        // Verify Photo Payload
        if (!photoPayload.PictureContent) console.error('❌ ERROR: Missing PictureContent');
        if (!photoPayload.CheckInTime) console.error('❌ ERROR: Missing CheckInTime');
        return new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
    }

    const response = await fetch('https://cimory-proxy.yohandi-pratama.workers.dev/api/sfaservice/uploadpict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(photoPayload)
    });
    
    // Read and log response body
    const responseText = await response.text();
    console.log(`[UPLOAD PICT RESPONSE Code: ${response.status}]:`, responseText);

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${responseText}`);
    }
    let result;
    try {
        result = JSON.parse(responseText);
    } catch(e) {
        result = responseText;
    }
    return result;
}


// ============================================
// UTILITY FUNCTIONS
// ============================================
function refreshStoreCard(storeCode) {
    const state = storeStates[storeCode];
    const card = document.querySelector(`[data-store-code="${storeCode}"]`);
    const wasExpanded = card.classList.contains('expanded');
    
    const newCard = createStoreCard(storeCode, state);
    card.replaceWith(newCard);
    
    if (wasExpanded) {
        newCard.classList.add('expanded');
    }
}

function getStatusText(status) {
    const statusMap = {
        'ready': 'Ready',
        'checked-in': 'Checked In',
        'checked-out': 'Checked Out'
    };
    return statusMap[status] || status;
}

function updateStoresCount() {
    const states = Object.values(storeStates);
    const total    = states.length;
    const uploaded = states.filter(s => s.isSynced).length;
    const ready    = states.filter(s => s.status === 'checked-out' && !s.isSynced).length;
    const pending  = total - uploaded - ready; // belum check-out

    // Update teks footer
    const el = document.getElementById('stores-count');
    if (el) {
        el.innerHTML = [
            `<span class="count-item">📋 <b>${total}</b> toko</span>`,
            `<span class="count-item ready">✅ <b>${ready}</b> siap upload</span>`,
            `<span class="count-item uploaded">☁️ <b>${uploaded}</b> terupload</span>`,
            `<span class="count-item pending">⏳ <b>${pending}</b> belum</span>`,
        ].join('');
    }

    // Tombol upload hanya aktif kalau ada yang siap
    if (btnUpload) {
        btnUpload.disabled = ready === 0;
        btnUpload.style.opacity = ready === 0 ? '0.45' : '1';
    }
}

function showUploadStatus(type, message) {
    const statusEl = document.getElementById('daily-status');
    if (statusEl) {
        statusEl.className = `header-status ${type}`; 
        statusEl.textContent = message;
        
        // Auto hide success messages after a while
        if(type === 'success') {
             setTimeout(() => {
                 statusEl.className = 'header-status hidden';
             }, 4000);
        }
    }
}

// ============================================
// DATA VALIDATION
// ============================================
function validateStoreCompleteness(storeCode) {
    const state = storeStates[storeCode];
    const issues = [];
    const warnings = [];
    
    // Check visit status
    if (!state.checkInTime) {
        issues.push('Check-in required');
    }
    if (!state.checkOutTime) {
        issues.push('Check-out required');
    }
    if (state.checkInTime && state.checkOutTime && state.checkOutTime <= state.checkInTime) {
        issues.push('Check-out must be after check-in');
    }
    
    // Check photos
    if (state.photos.checkin.length !== 1) {
        issues.push(`Check-in photo: ${state.photos.checkin.length}/1 required`);
    }
    if (state.photos.before.length < 1) {
        issues.push(`Before photos: ${state.photos.before.length} (Min 1 required)`);
    }
    if (state.photos.after.length < 1) {
        issues.push(`After photos: ${state.photos.after.length} (Min 1 required)`);
    }
    
    // Check GPS (not default values)
    const defaultLat = state.storeData.RKMD.Latitude;
    const defaultLng = state.storeData.RKMD.Longitude;
    if (state.gpsLat === defaultLat && state.gpsLng === defaultLng) {
        warnings.push('Using default GPS coordinates (consider adding jitter)');
    }
    
    // Check stock (warning only)
    const hasStock = state.stockData && state.stockData.some(item => item.JumSatuan > 0);
    if (!hasStock) {
        warnings.push('No stock data entered');
    }
    
    return {
        isComplete: issues.length === 0,
        hasWarnings: warnings.length > 0,
        issues,
        warnings
    };
}

