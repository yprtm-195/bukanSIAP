/**
 * Cimory SIAP Web Tool V2 - Multi-Store Logic
 */

// ============================================
// STATE MANAGEMENT
// ============================================
let rkmData = null; // Original full data from server/file
let storeStates = {}; // Persisted state { storeCode: { checkInTime, photos, etc } }
let currentAppTab = 'tasks'; // Default tab: 'tasks', 'ready', 'history'

// Initialize Tabs on Load
window.switchTab = function(tabId) {
    currentAppTab = tabId;
    
    // Auto-collapse all items on tab switch to ensure clean view
    for (let code in storeStates) {
        if (storeStates[code]) {
            storeStates[code].openSection = null;
        }
    }

    // Update UI active state
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
        const text = tab.textContent.toLowerCase();
        if (tabId === 'tasks' && text.includes('tugas')) tab.classList.add('active');
        if (tabId === 'ready' && text.includes('siap')) tab.classList.add('active');
        if (tabId === 'history' && text.includes('selesai')) tab.classList.add('active');
    });

    // Toggle FAB Visibility (Hanya muncul di tab Tugas)
    const fab = document.getElementById('fab-pricetag');
    if (fab) {
        if (tabId === 'tasks') {
            fab.style.display = 'flex';
        } else {
            fab.style.display = 'none';
        }
    }

    // Toggle Server Verification Action Visibility (In Footer)
    const verifyAction = document.getElementById('verify-action-container');
    const uploadBtn = document.getElementById('btn-upload');
    
    if (tabId === 'history') {
        if (verifyAction) verifyAction.classList.remove('hidden');
        if (uploadBtn) uploadBtn.classList.add('hidden');
    } else {
        if (verifyAction) verifyAction.classList.add('hidden');
        if (uploadBtn) uploadBtn.classList.remove('hidden');
    }

    renderStoreCards();
    
    // Save tab preference
    localStorage.setItem('LAST_ACTIVE_TAB', tabId);
};

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

// CONFIG & API ENDPOINTS
// MOCK_UPLOAD diatur dari config.js (true = trial, false = production)
const PROXY_URL = "https://cimory-proxy.yohandi-pratama.workers.dev"; // Cloudflare Workers Proxy
const DMS_BASE_URL = "https://dms.cimory.com";

// Endpoint Helper (biar rapi)
const getDmsUrl = (path, cookie = null) => {
    let url = "";
    if (PROXY_URL && PROXY_URL.includes("workers.dev")) {
        url = `${PROXY_URL}${path}`;
    } else {
        url = `${DMS_BASE_URL}${path}`;
    }
    
    if (cookie) {
        url += (url.includes('?') ? '&' : '?') + '_cookie=' + encodeURIComponent(cookie);
    }
    return url;
};
document.addEventListener('DOMContentLoaded', () => {
    // Tombol upload disabled by default sampai ada toko siap
    if (btnUpload) { btnUpload.disabled = true; btnUpload.style.opacity = '0.45'; }

    // Cek setup SIAP credentials dulu sebelum apapun (Dihapus agar tidak auto-popup karena pake default RIKI/1234)
    // checkSiapSetup(); // <-- DIMATIKAN

    initIndexedDB();
    fetchExternalStock();
    setupPayloadGeneration();
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    // Update tooltip akun jika sudah tersimpan
    updateAccountTooltip();

    // Inisialisasi Tab (Muat tab terakhir atau default ke 'tasks')
    const lastTab = localStorage.getItem('LAST_ACTIVE_TAB') || 'tasks';
    switchTab(lastTab);
});

// ============================================
// Helper buat ambil credentials SIAP (localStorage first, fallback config.js, fallback default)
function getSiapCredentials() {
    return {
        username: localStorage.getItem('SIAP_STORED_USER') || (typeof SIAP_USERNAME !== 'undefined' ? SIAP_USERNAME : 'RIKI'),
        password: localStorage.getItem('SIAP_STORED_PASS') || (typeof SIAP_PASSWORD !== 'undefined' ? SIAP_PASSWORD : '1234')
    };
}

function updateAccountTooltip() {
    const saved = localStorage.getItem('USER_EMAIL_DMS');
    
    // Update email display di dropdown
    const emailDisplay = document.getElementById('ami-email-display');
    if (emailDisplay) emailDisplay.textContent = saved || 'Belum di-setup';
    
    const accountHint = document.getElementById('ami-account-hint');
    if (accountHint) accountHint.textContent = saved ? `Akun: ${saved.split('@')[0]}` : 'Tarik RKM dari DMS';
}

window.toggleActionMenu = function(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('action-menu-dropdown');
    const btn = document.getElementById('btn-action-menu');
    const isOpen = !dropdown.classList.contains('hidden');

    if (isOpen) {
        closeActionMenu();
    } else {
        dropdown.classList.remove('hidden');
        btn.classList.add('open');

        // Listener buat klik di mana aja buat nutup menu
        const closeOnOutside = (event) => {
            const wrapper = document.getElementById('action-menu-wrapper');
            if (wrapper && !wrapper.contains(event.target)) {
                closeActionMenu();
                document.removeEventListener('click', closeOnOutside);
            }
        };

        // Tunggu bentar baru pasang biar ga kena klik yang sekarang
        setTimeout(() => {
            document.addEventListener('click', closeOnOutside);
        }, 10);
    }
};

window.closeActionMenu = function() {
    const dropdown = document.getElementById('action-menu-dropdown');
    const btn = document.getElementById('btn-action-menu');
    if (dropdown) dropdown.classList.add('hidden');
    if (btn) btn.classList.remove('open');
};

function handleOutsideMenuClick(e) {
    // Fungsi lama diganti oleh logic di dalam toggleActionMenu
}
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
                        // No prompt, force restore to protect data
                        rkmData = savedRKM;
                        processRKMData(rkmData, true); 
                        storeStates = savedStates;

                        console.log('Session restored successfully');
                        renderStoreCards();
                        updateStoresCount(); 
                        
                        const statusDiv = document.getElementById('daily-status');
                        if (statusDiv) {
                            statusDiv.textContent = 'Session Auto-Restored ✔️';
                            statusDiv.className = 'header-status success';
                            setTimeout(() => {
                                statusDiv.style.display = 'none';
                            }, 3000);
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



const DMS_RKM_URL = "https://cimory-proxy.yohandi-pratama.workers.dev/api/sfaservice/downloadrkm";

// Load Daily Data — Sekarang dari DMS Server via Cloudflare Proxy!
async function loadDailyRKM() {
    // Cek sesi aktif dulu
    if (Object.keys(storeStates).length > 0) {
        const proceed = await cimoryConfirm("Kalo lu nge-load RKM dari server sekarang, SEMUA KERJAAN hari ini bakal HANGUS dan mulai dari nol.\n\nLu yakin mau ngapus dan narik data baru?", "⛔ ADA SESI KERJA AKTIF!", "⛔");
        if (!proceed) return;
    }
    
    // Cek email tersimpan
    const savedEmail = localStorage.getItem('USER_EMAIL_DMS');
    if (!savedEmail) {
        // Belum ada email, tampilkan modal setup
        openEmailModal();
        return;
    }
    
    // Email ada, langsung tarik!
    await doDownloadRKM(savedEmail);
}

// Buka modal email, pre-fill kalau ada email tersimpan
function openEmailModal() {
    const modal = document.getElementById('email-modal');
    const inputEmail = document.getElementById('input-user-email');
    const inputMds = document.getElementById('input-mds-name');
    
    const savedEmail = localStorage.getItem('USER_EMAIL_DMS');
    const savedMds = localStorage.getItem('USER_MDS_NAME');
    
    if (inputEmail && savedEmail) inputEmail.value = savedEmail;
    if (inputMds && savedMds) inputMds.value = savedMds;
    
    if (inputEmail && savedEmail) {
        const label = document.getElementById('email-modal-label');
        if (label) label.textContent = 'Email Akun DMS (tersimpan):';
    }
    
    if (modal) modal.classList.remove('hidden');
    if (inputEmail) setTimeout(() => { inputEmail.select(); }, 100);
}

// Dipanggil dari tombol modal setelah user isi email
async function saveEmailAndDownload() {
    const inputEmail = document.getElementById('input-user-email');
    const inputMds = document.getElementById('input-mds-name');
    
    const email = inputEmail?.value?.trim();
    const mdsName = inputMds?.value?.trim()?.toUpperCase();
    
    if (!email || !email.includes('@')) {
        inputEmail.style.borderColor = 'var(--accent-danger)';
        return;
    }
    
    if (VERIFICATION_ENABLED && !mdsName) {
        inputMds.style.borderColor = 'var(--accent-danger)';
        inputMds.placeholder = 'Nama MDS wajib diisi!';
        return;
    }
    
    localStorage.setItem('USER_EMAIL_DMS', email);
    if (mdsName) localStorage.setItem('USER_MDS_NAME', mdsName);
    
    updateAccountTooltip();
    document.getElementById('email-modal').classList.add('hidden');
    await doDownloadRKM(email);
}

// Core download function
async function doDownloadRKM(email) {
    const statusDiv = document.getElementById('daily-status');
    const btn = document.querySelector('.btn-action-server');
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">⏳</span> <span class="mobile-hidden">Proses Sync RKM...</span>';
    }
    statusDiv.style.display = 'block';
    statusDiv.className = 'header-status loading';
    statusDiv.textContent = `Proses Sync RKM untuk ${email}...`;
    
    clearSession();
    
    try {
        const url = getDmsUrl("/api/sfaservice/downloadrkm");
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Key: 'IMEI', Value: email })
        });
        
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        
        const data = await response.json();
        
        // Cek status download dari DMS
        if (data.StatusDownload === 'NO') {
            throw new Error(data.ErrorMessage || 'Gak ada data RKM hari ini. Mungkin belum dibuka oleh Admin atau sudah closing.');
        }
        
        if (!data.StatusDownload || !data.ListRKMDetail) {
            throw new Error(`Format tidak dikenali dari server DMS. Keys: ${Object.keys(data).join(', ')}`);
        }
        
        // Data valid — langsung pakai (flat structure, no wrapper)
        const rkmPayload = data;
        
        statusDiv.className = 'header-status success';
        statusDiv.textContent = `✓ Data RKM berhasil ditarik!`;
        
        // Auto sync master data Google
        await silentSyncMasterData();
        processRKMData(rkmPayload);
        
        setTimeout(() => {
            if (statusDiv) statusDiv.style.display = 'none';
            const loaderDiv = document.getElementById('global-loader');
            if (loaderDiv) loaderDiv.classList.add('hidden');
        }, 600);
        
    } catch (error) {
        console.error('RKM download failed:', error);
        
        // Tangani CORS error secara khusus (Harusnya sudah aman lewat proxy)
        const isCORS = error.message === 'Failed to fetch' || error.name === 'TypeError';

        if (isCORS) {
            statusDiv.className = 'header-status error';
            statusDiv.textContent = '❌ Koneksi Bermasalah — Pastikan internet lu nyala atau proxy Cloudflare lagi nggak down bro!';
        } else {
            statusDiv.className = 'header-status error';
            statusDiv.textContent = `❌ ${error.message}`;
        }    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">☁️</span> <span class="mobile-hidden">Server Sinkron</span>';
        }
    }
}

// MASTER DATA SYNC (GOOGLE APPS SCRIPT API - VIA PROXY)
const GAS_API_URL = "https://cimory-proxy.yohandi-pratama.workers.dev/gas/macros/s/AKfycbwCGmVNAIXN6gbRAMh4REPmtojiSErXHezAAifiy43Umm1SP2U6AahJjniZLQX-jEpqyw/exec";

async function silentSyncMasterData() {
    const loaderDiv = document.getElementById('global-loader');
    const loaderTitle = document.getElementById('loader-title');
    const loaderText = document.getElementById('loader-text');
    const progressBar = document.getElementById('loader-progress-bar');
    const progressText = document.getElementById('loader-progress-text');
    
    // Show Full Screen Loader
    if (loaderDiv) loaderDiv.classList.remove('hidden');
    if (loaderTitle) loaderTitle.textContent = "Proses Sync RKM...";
    if (loaderText) loaderText.textContent = "Proses Sync master kordinat & produk terupdate dari Lokal Server.";
    
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
    
    let progressNum = 0;
    const fakeProgressInterval = setInterval(() => {
        if (progressNum < 90) {
            progressNum += Math.floor(Math.random() * 15) + 5;
            if (progressNum > 90) progressNum = 90;
            if (progressBar) progressBar.style.width = progressNum + '%';
            if (progressText) progressText.textContent = progressNum + '%';
        }
    }, 400);
    
    // Fallback UI Banner
    const statusDiv = document.getElementById('daily-status');
    if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.className = 'header-status loading';
        statusDiv.textContent = 'Menarik Master Data Cloud...';
    }
    
    try {
        const res = await fetch(GAS_API_URL, { redirect: "follow" });
        if(!res.ok) throw new Error("HTTP " + res.status);
        
        const json = await res.json();
        clearInterval(fakeProgressInterval);
        
        if(json.status === 'success') {
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = '100%';
            
            localStorage.setItem('STORE_MASTER_LIVE', JSON.stringify(json.data));
            if (statusDiv) {
                statusDiv.className = 'header-status success';
                statusDiv.textContent = `✓ Auto-Patch Ready (${json.totalToko} Toko)`;
            }
            if (loaderTitle) loaderTitle.textContent = "Data berhasil sync!";
            if (loaderText) loaderText.textContent = "Lagi rombak file RKM (Tunggu bentar)...";
        } else {
            throw new Error(json.message);
        }
    } catch(err) {
        clearInterval(fakeProgressInterval);
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Mode Offline';
        
        console.warn("Silent sync failed, falling back to local cache:", err);
        if (statusDiv) {
            statusDiv.className = 'header-status error';
            statusDiv.textContent = `⚠️ Mode Offline: Gagal Narik Master Terkini`;
        }
    }
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        if (Object.keys(storeStates).length > 0) {
            const proceed = await cimoryConfirm("Kalo lu nge-load JSON sekarang, SEMUA KERJAAN hari ini bakal HANGUS bro.\n\nLu yakin mau nimpa pakai file ini?", "⛔ ADA SESI KERJA AKTIF!", "⛔");
            if (!proceed) {
                e.target.value = ''; // Reset input to allow re-selecting same file later
                return;
            }
        }
        clearSession();
        processFile(file);
    }
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await silentSyncMasterData();
            processRKMData(data);
            
            setTimeout(() => {
                const statusDiv = document.getElementById('daily-status');
                if(statusDiv) statusDiv.style.display = 'none';
                
                // Hide Full Screen Loader after render
                const loaderDiv = document.getElementById('global-loader');
                if(loaderDiv) loaderDiv.classList.add('hidden');
            }, 600);
            
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
    
    // --- AUTO-PATCH LOGIC VIA LOCALSTORAGE (API SYNC) ---
    const localMaster = localStorage.getItem('STORE_MASTER_LIVE');
    let STORE_MASTER = null;
    try { STORE_MASTER = JSON.parse(localMaster); } catch(e) {}
    
    if (!isRestore && STORE_MASTER && typeof STORE_MASTER === 'object' && Object.keys(STORE_MASTER).length > 0) {
        console.log("🛠️ STORE_MASTER terdeteksi dari Cache API! Mengoperasi file RKM mentah...");
        
        const patchedStock = [];
        let replacedCoords = 0;
        
        data.ListRKMDetail.forEach(store => {
            const storeCode = store.RKMD.KodeCustomer.trim();
            const master = STORE_MASTER[storeCode];
            
            if (master) {
                // A. Patch Kordinat GPS
                if (master.lat !== undefined && master.lat !== 0) {
                    store.RKMD.Latitude = master.lat;
                    store.RKMD.Longitude = master.lng;
                    replacedCoords++;
                }
                
                // B. Patch ListRKMStok
                if (Array.isArray(master.products)) {
                    master.products.forEach(prodCode => {
                        const pMaster = data.ListBarang ? data.ListBarang.find(p => (p.KodeBarang||p.KodeBrg||'').trim() === prodCode.trim()) : null;
                        const prodName = pMaster ? (pMaster.NamaBrg || pMaster.NamaBarang) : prodCode;
                        
                        patchedStock.push({
                            KodeCustomer: storeCode,
                            KodeBarang: prodCode,
                            NamaBrg: prodName,
                            JumKarton: 0,
                            JumSatuan: 0,
                            JumPcsE: 0,
                            TanggalRKM: store.RKMD.TanggalRKM || new Date().toISOString().split('T')[0],
                            KodeMerchandiser: store.RKMD.KodeMerchandiser || ""
                        });
                    });
                }
            } else {
                if(data.ListRKMStok) {
                    const originalStock = data.ListRKMStok.filter(item => item.KodeCustomer.trim() === storeCode);
                    patchedStock.push(...originalStock);
                }
            }
        });
        
        data.ListRKMStok = patchedStock;
        console.log(`🛠️ Operasi RKM via API Cache Selesai! Mengupdate koordinat pada ${replacedCoords} toko.`);
    }
    // ------------------------------------------
    
    rkmData = data;

    // Simpen Master Alasan buat Skip Visit
    if (data.ListAlasan) {
        localStorage.setItem('DMS_REASONS', JSON.stringify(data.ListAlasan));
        console.log("✅ Master Alasan Skip Visit Berhasil Disimpan.");
    }
    
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
            } else if (store.RKMD.ReasonTime) {
                initialStatus = 'skipped';
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
    
    // Tampilkan search bar
    const searchBar = document.getElementById('search-bar-container');
    if (searchBar) searchBar.style.display = 'block';
    
    // Show success
    showUploadStatus('success', `✓ ${isRestore ? 'Session Restored' : 'Loaded'} (${data.ListRKMDetail.length} stores)`);
    storesContainer.classList.remove('hidden');
    updateStoresCount();
    
    // Auto-collapse upload section removed
}

// ============================================
// LIVE SEARCH
// ============================================
function filterStores(query) {
    const q = query.trim().toLowerCase();
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
    
    // In Tabbed UI, we re-render everything based on search
    renderStoreCards();
}

function clearSearch() {
    const input = document.getElementById('live-store-search');
    if (input) {
        input.value = '';
        filterStores('');
        input.focus();
    }
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

function updateManualStock(storeCode, itemCode, newValue, element) {
    const state = storeStates[storeCode];
    const qty = parseInt(newValue) || 0;

    // Update in state.stockData
    const itemIndex = state.stockData.findIndex(i => (i.KodeBarang || i.KodeBrg || "").trim() === itemCode.trim());
    if (itemIndex !== -1) {
        state.stockData[itemIndex].JumSatuan = qty;
        console.log(`[STOK] ${storeCode} - ${itemCode} updated to: ${qty}`);
        
        // Live color update
        if (element) {
            element.style.color = qty > 0 ? '#3fb950' : '#f85149';
            element.style.fontWeight = qty > 0 ? 'bold' : 'normal';
        }

        // Save to session so it persists refresh
        saveSession();
    }
}

async function reOpenStore(storeCode) {
    if (!await cimoryConfirm('Buka kuncian toko ini buat diedit/re-upload lagi?', 'Konfirmasi Buka Toko', '✏️')) return;
    
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
    const searchQuery = document.getElementById('live-store-search')?.value?.trim().toLowerCase() || '';

    // 1. Grouping stores for stats & badges
    const tasks = allStoreCodes.filter(code => {
        const s = storeStates[code];
        const isSkipped = s.status === 'skipped';
        return !s.isSynced && s.status !== 'checked-out' && !isSkipped;
    });
    
    const ready = allStoreCodes.filter(code => {
        const s = storeStates[code];
        const isSkipped = s.status === 'skipped';
        return !s.isSynced && (s.status === 'checked-out' || isSkipped);
    });

    const history = allStoreCodes.filter(code => storeStates[code].isSynced);

    // 2. Update Tab Badges
    updateTabBadge('tasks', tasks.length);
    updateTabBadge('ready', ready.length);
    updateTabBadge('history', history.length);

    // 3. Filter stores to display based on current tab
    let displayCodes = [];
    if (currentAppTab === 'tasks') displayCodes = tasks;
    else if (currentAppTab === 'ready') displayCodes = ready;
    else if (currentAppTab === 'history') displayCodes = history;

    // 4. Apply Global Search Filter
    if (searchQuery) {
        displayCodes = displayCodes.filter(code => {
            const s = storeStates[code];
            const name = (s.storeData?.RKMD?.NamaCustomer || s.storeData?.NamaCustomer || '').toLowerCase();
            return code.toLowerCase().includes(searchQuery) || name.includes(searchQuery);
        });
    }

    // 5. Toggle Footer Visibility
    const footer = document.querySelector('.app-footer');
    if (footer) {
        // Show footer in 'ready' tab (for upload) OR 'history' tab (for verification)
        const shouldShowReady = currentAppTab === 'ready' && ready.length > 0;
        const shouldShowHistory = currentAppTab === 'history';
        
        if (shouldShowReady || shouldShowHistory) {
            footer.classList.remove('footer-hidden');
        } else {
            footer.classList.add('footer-hidden');
        }
    }

    // 6. Render Cards or Table
    if (displayCodes.length === 0) {
        storesContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${searchQuery ? '🔍' : '🏜️'}</div>
                <div class="empty-text">${searchQuery ? 'Gak nemu toko yang cocok bro...' : 'Tab ini kosong melompong bro!'}</div>
            </div>
        `;
    } else if (currentAppTab === 'history') {
        // RENDER AS TABLE FOR HISTORY
        const wrapper = document.createElement('div');
        wrapper.className = 'history-table-wrapper';
        
        let tableHtml = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th style="text-align:left">Toko</th>
                        <th>Status</th>
                        <th>Server</th>
                        <th>Aksi</th>
                    </tr>
                </thead>
                <tbody>
        `;

        displayCodes.forEach(storeCode => {
            const state = storeStates[storeCode];
            const storeName = state.storeData.RKMD?.NamaCustomer || state.storeData.NamaCustomer || storeCode;
            const isSkipped = state.status === 'skipped';
            
            tableHtml += `
                <tr>
                    <td>
                        <div class="ht-name">${storeName}</div>
                        <div class="ht-code">${storeCode}</div>
                    </td>
                    <td align="center">
                        <span class="ht-badge ${isSkipped ? 'skipped' : 'synced'}">
                            ${isSkipped ? '❌ Skip' : '☁️ OK'}
                        </span>
                    </td>
                    <td align="center">
                        ${state.isSyncedFromServer ? 
                            '<span class="ht-badge verified" title="Jam Out: '+ (state.serverTimeOut || '-') +'">✅ FIX</span>' : 
                            '<span class="ht-badge pending">⏳ NO</span>'}
                    </td>
                    <td align="center">
                        <button class="ht-btn-edit" onclick="reOpenStore('${storeCode}')" title="Edit/Re-upload">✏️</button>
                    </td>
                </tr>
            `;
        });

        tableHtml += `</tbody></table>`;
        wrapper.innerHTML = tableHtml;
        storesContainer.appendChild(wrapper);
    } else {
        // RENDER AS CARDS FOR TASKS & READY
        displayCodes.forEach(storeCode => {
            const card = createStoreCard(storeCode, storeStates[storeCode]);
            storesContainer.appendChild(card);
        });
    }

    saveSession();
}

function updateTabBadge(tabId, count) {
    const badge = document.getElementById(`badge-${tabId}`);
    if (!badge) return;
    
    if (count > 0) {
        badge.textContent = count;
        badge.classList.add('visible');
    } else {
        badge.classList.remove('visible');
    }
}
function createStoreCard(storeCode, state) {
    const card = document.createElement('div');
    const isSkipped = state.status === 'skipped';
    card.className = `store-card ${state.status === 'checked-out' ? 'store-locked' : ''} ${isSkipped ? 'skipped' : ''} ${state.isSynced ? 'is-synced' : ''}`;
    card.dataset.storeCode = storeCode;
    card.dataset.status = state.status; // Biar CSS bisa kasih warna aksen
    
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
    // Priority 4: Skipped (Not Visited)
    else if (state.status === 'skipped') {
        badgeClass = 'status-tag skipped';
        badgeIcon = '❌';
        badgeText = 'Skil / Dilewati';
    }
    // Priority 5: Default (Not Started)
    else {
        badgeClass = 'status-ready';
        badgeIcon = '○';
        badgeText = 'Belum Mulai';
    }

    const storeName = state.storeData.RKMD?.NamaCustomer || state.storeData.NamaCustomer || storeCode;

    // Consolidate badge info for "Clean & Simple"
    let finalBadgeIcon = badgeIcon;
    let finalBadgeClass = badgeClass;
    let cardGlowClass = "";

    if (state.isSyncedFromServer) {
        finalBadgeIcon = "✅"; // Force blue checkmark
        finalBadgeClass = "server-verified"; // CSS handle for blue color
        cardGlowClass = "server-verified-glow"; // Neon effect
    }

    card.className = `store-card ${state.status === 'checked-out' ? 'is-complete' : ''} ${state.status === 'skipped' ? 'skipped' : ''} ${state.isSynced ? 'is-synced' : ''} ${state.status === 'checked-in' ? 'checked-in' : ''} ${state.status === 'checked-out' ? 'store-locked' : ''} ${state.isExpanded ? 'expanded' : ''} ${cardGlowClass}`;
    
    card.setAttribute('data-status', state.status);
    card.setAttribute('data-store', storeCode);
    card.id = `store-card-${storeCode}`;

    card.innerHTML = `
        <div class="store-header" onclick="toggleStoreCard('${storeCode}')">
            <!-- Single Smart Badge as Top Right Icon of the Card -->
            <span class="completeness-badge ${finalBadgeClass}" title="${badgeText}">${finalBadgeIcon}</span>
            
            <div class="store-icon-wrapper">
                <img src="icons/store-icon.jpg" class="store-icon" alt="store">
            </div>

            <div class="store-details">
                <div class="store-name">${storeName}</div>
                <div class="store-header-bottom">
                    <span class="store-code">${storeCode}</span>
                    ${state.isSynced ? `
                        <button class="btn-reupload" onclick="event.stopPropagation(); reOpenStore('${storeCode}')">
                            ✏️ Edit & Re-Upload
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
        <div class="store-body">
            <div class="store-content">
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
                <div class="gps-display-row" style="margin-bottom: 12px; font-size: 13px; color: var(--text-secondary);">
                    <span>Titik Koordinat: <strong id="gps-text-${storeCode}" style="color: var(--text-primary); font-family: monospace;">${state.gpsLat}, ${state.gpsLng}</strong></span>
                </div>
                <div class="gps-controls">
                    <button class="btn-secondary" onclick="useDeviceGPS('${storeCode}')" ${disabledAttr}>
                        📡 GPS Asli
                    </button>
                    <button class="btn-secondary" onclick="addJitter('${storeCode}')" ${disabledAttr}>
                        Fake GPS 📌
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

    // Pastikan ukuran map pas setelah animasi accordion selesai (CSS transition 300ms)
    setTimeout(() => {
        map.invalidateSize();
    }, 350);
}

function renderTimelineSection(storeCode, state) {
    const isReadOnly = state.status === 'checked-out';
    const disabledAttr = isReadOnly ? 'disabled' : '';

    const isComplete = state.checkInTime && state.checkOutTime;
    const validClass = isComplete ? '' : 'section-incomplete';

    const isSkipped = state.status === 'skipped';
    
    const checkInDisabled  = isReadOnly || state.status !== 'ready' || isSkipped;
    const checkOutDisabled = isReadOnly || state.status !== 'checked-in' || isSkipped;

    // Photo helpers
    const photos = state.photos;
    const isPhotoComplete = photos.checkin.length >= 1 &&
                            photos.before.length  >= 1 &&
                            photos.after.length   >= 1;
    const photoDisabled = (isReadOnly || isSkipped) ? 'disabled' : '';

    // Format stored timestamps ke HH:mm
    const fmtTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    // Helper for thumbnails
    const renderThumbnails = (arr, category) => {
        return arr.map((p, idx) => `
            <div class="photo-thumbnail-wrapper">
                <img src="${p.thumbnail}" class="photo-thumbnail" alt="foto" onclick="openImageFull('${storeCode}', '${category}', ${idx})" />
                ${isReadOnly ? '' : `<button class="photo-delete-btn" onclick="removePhoto('${storeCode}', '${category}', ${idx})" title="Hapus Foto">×</button>`}
            </div>
        `).join('');
    };

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
                        <label class="timeline-simple-label">   ⏰ Check In    <small style="font-size: 8px; opacity: 0.5;">(24h)</small></label>
                        <input type="text" class="time-input-simple time-input-hh time-input-checkin-hh" placeholder="HH" inputmode="numeric" maxlength="2" value="${fmtTime(state.checkInTime).split(':')[0] || ''}" ${checkInDisabled ? 'disabled' : ''} onkeydown="handleEnterAsTab(event)" onkeypress="handleEnterAsTab(event)" oninput="autoFocusNext(this)" onfocus="this.select()">
                        <span class="time-input-separator">:</span>
                        <input type="text" class="time-input-simple time-input-mm time-input-checkin-mm" placeholder="mm" inputmode="numeric" maxlength="2" value="${fmtTime(state.checkInTime).split(':')[1] || ''}" ${checkInDisabled ? 'disabled' : ''} onkeydown="handleEnterAsTab(event)" onkeypress="handleEnterAsTab(event)" onfocus="this.select()">
                    </div>
                    <button
                        class="btn-checkin"
                        onclick="handleCheckIn('${storeCode}')"
                        ${checkInDisabled ? 'disabled' : ''}>
                        ${state.checkInTime ? '✅ ' + fmtTime(state.checkInTime) : (isSkipped ? '❌ SKIPPED' : '▶ IN')}
                    </button>
                    ${state.status === 'ready' ? `
                        <button class="btn-skip-visit" onclick="openSkipModal('${storeCode}')" title="Mark as Not Visited">
                            ❌ Tidak dikunjungi
                        </button>
                    ` : ''}
                </div>

                ${isSkipped ? `
                <div class="skip-info-box" style="background: rgba(231, 76, 60, 0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(231, 76, 60, 0.2); margin: 10px 0;">
                    <div style="font-size: 11px; color: #e74c3c; font-weight: bold; margin-bottom: 5px;">DETAIL TIDAK DIKUNJUNGI:</div>
                    <div style="font-size: 13px; color: #fff; margin-bottom: 4px;">🎯 Alasan: <strong>${state.reasonCode || '-'}</strong></div>
                    <div style="font-size: 12px; color: #aaa; font-style: italic;">📝 Keterangan: "${state.reasonText || '-'}"</div>
                    <div style="font-size: 10px; color: #888; margin-top: 8px;">⏰ Waktu: ${state.skipTime ? new Date(state.skipTime).toLocaleString('id-ID') : '-'}</div>
                </div>
                ` : ''}

                <!-- PHOTO UPLOAD SECTION (Unified Grid) -->
                <div class="timeline-photo-block ${isPhotoComplete ? 'photo-complete' : ''}">
                    <div class="timeline-photo-title">
                        📸 Foto Dokumentasi ${isPhotoComplete ? '✅' : '<span class="section-warning-icon">⚠</span>'}
                    </div>
                    <div class="timeline-photo-grid">
                        <!-- Check-In Category -->
                        <div class="timeline-photo-item">
                            <label class="timeline-photo-label">Check-In</label>
                            <div class="photo-gallery-container">
                                ${photos.checkin.length === 0 ? `
                                    <label class="custom-file-btn" ${isReadOnly ? 'style="opacity:.4;pointer-events:none;"' : ''}>
                                        <span>📷</span>
                                        <span>Pilih</span>
                                        <input type="file" accept="image/*" onchange="handlePhotoUpload('${storeCode}', 'checkin', this.files, 1)" ${photoDisabled} hidden>
                                    </label>
                                ` : renderThumbnails(photos.checkin, 'checkin')}
                            </div>
                        </div>

                        <!-- Before Category -->
                        <div class="timeline-photo-item">
                            <label class="timeline-photo-label">Before</label>
                            <div class="photo-gallery-container">
                                ${renderThumbnails(photos.before, 'before')}
                                ${(!isReadOnly && photos.before.length < 20) ? `
                                    <label class="custom-file-btn">
                                        <span>📷</span>
                                        <span>+ Foto</span>
                                        <input type="file" accept="image/*" multiple onchange="handlePhotoUpload('${storeCode}', 'before', this.files, 20)" ${photoDisabled} hidden>
                                    </label>
                                ` : ''}
                            </div>
                        </div>

                        <!-- After Category -->
                        <div class="timeline-photo-item">
                            <label class="timeline-photo-label">After</label>
                            <div class="photo-gallery-container">
                                ${renderThumbnails(photos.after, 'after')}
                                ${(!isReadOnly && photos.after.length < 20) ? `
                                    <label class="custom-file-btn">
                                        <span>📷</span>
                                        <span>+ Foto</span>
                                        <input type="file" accept="image/*" multiple onchange="handlePhotoUpload('${storeCode}', 'after', this.files, 20)" ${photoDisabled} hidden>
                                    </label>
                                ` : ''}
                            </div>
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
                        ${state.checkOutTime ? '✅ ' + fmtTime(state.checkOutTime) : '   ⏰ Check Out   '}
                    </button>
                </div>
            </div>
            </div>
        </div>
    `;
}


function renderStockSection(storeCode, state) {
    const open = (state.openSection === 'stock');
    
    // Sort stockData by KodeBarang numerically/alphabetically (Sat-set)
    const sortedStock = [...(state.stockData || [])].sort((a, b) => {
        const codeA = (a.KodeBarang || a.KodeBrg || "").trim();
        const codeB = (b.KodeBarang || b.KodeBrg || "").trim();
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const stockList = sortedStock
        .map(item => {
            const itemCode = (item.KodeBarang || item.KodeBrg || "").trim();
            const qty = item.JumSatuan || 0;
            const name = item.NamaBrg || item.NamaBarang || 'Unknown Product';
            const qtyColor = qty > 0 ? '#3fb950' : '#f85149'; 
            
            return `
            <div class="stock-item">
                <span class="stock-name">${itemCode} - ${name}</span>
                <div class="stock-input-wrapper">
                    <input type="number"
                           class="manual-stock-input"
                           style="color: ${qtyColor}; font-weight: ${qty > 0 ? 'bold' : 'normal'};"
                           value="${qty}"
                           min="0"
                           inputmode="numeric"
                           onchange="updateManualStock('${storeCode}', '${itemCode}', this.value, this)"
                           onkeydown="handleEnterAsTab(event)"
                           onkeypress="handleEnterAsTab(event)"
                           ${state.isSynced ? 'disabled' : ''}>
                    <span class="stock-unit">pcs</span>
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
    const opening = state.openSection !== section;
    state.openSection = opening ? section : null;
    
    refreshStoreCard(storeCode);

    // Auto-scroll ke sub-section yang baru dibuka
    if (opening) {
        setTimeout(() => {
            const card = document.querySelector(`[data-store-code="${storeCode}"]`);
            if (card) {
                // Cari title section-nya (pake search text atau urutan)
                const titles = card.querySelectorAll('.section-accordion-title');
                let target = null;
                if (section === 'gps') target = titles[0];
                else if (section === 'timeline') target = titles[1];
                else if (section === 'stock') target = titles[2];

                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }, 200);
    } else {
        // FOCUS BACK TO MAIN CARD when closing a sub-section
        setTimeout(() => {
            const card = document.querySelector(`[data-store-code="${storeCode}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    // Re-init map kalau gps dibuka
    if (state.openSection === 'gps') {
        setTimeout(() => initMap(storeCode), 250);
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

// Hapus foto dari state
window.removePhoto = async function(storeCode, category, index) {
    const state = storeStates[storeCode];
    if (!state || state.isSynced) return;
    
    if (await cimoryConfirm('Hapus foto ini?', 'Hapus Foto', '🗑️')) {
        state.photos[category].splice(index, 1);
        saveSession();
        refreshStoreCard(storeCode);
    }
};

// Open Full Image (Safe version)
window.openImageFull = function(storeCode, category, index) {
    const state = storeStates[storeCode];
    if (!state || !state.photos[category][index]) return;
    
    const base64 = state.photos[category][index].base64;
    const newTab = window.open();
    if (newTab) {
        newTab.document.title = `Preview Foto - ${category}`;
        newTab.document.body.style.margin = "0";
        newTab.document.body.style.background = "#000";
        newTab.document.body.style.display = "flex";
        newTab.document.body.style.alignItems = "center";
        newTab.document.body.style.justifyContent = "center";
        newTab.document.body.innerHTML = `<img src="${base64}" style="max-width:100%; max-height:100vh; object-fit: contain;">`;
    } else {
        alert("Popup terblokir! Izinkan popup untuk melihat foto.");
    }
};


window.toggleStoreCard = function(storeCode) {
    const state = storeStates[storeCode];

    const card = document.querySelector(`[data-store-code="${storeCode}"]`);
    const isExpanded = card.classList.contains('expanded');
    
    // Collapse all other cards first (Accordion style)
    document.querySelectorAll('.store-card.expanded').forEach(c => {
        if (c !== card) {
            c.classList.remove('expanded');
            // update state as well
            const cCode = c.dataset.storeCode;
            if (cCode && storeStates[cCode]) {
                storeStates[cCode].isExpanded = false;
            }
        }
    });

    if (isExpanded) {
        card.classList.remove('expanded');
        state.isExpanded = false;
        
        // FOCUS BACK TO CARD when collapsing main card
        setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 350);
    } else {
        card.classList.add('expanded');
        state.isExpanded = true;
        
        // Wait for other cards to fully collapse before scrolling to this one
        setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Keep start for main card opening, it works better
        }, 350); 

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
    
    // Sync text display
    const textDisplay = document.getElementById(`gps-text-${storeCode}`);
    if (textDisplay) textDisplay.textContent = `${state.gpsLat}, ${state.gpsLng}`;
    
    saveSession();
}

// New: Use real device GPS + apply jitter
async function useDeviceGPS(storeCode) {
    if (!navigator.geolocation) {
        await cimoryAlert('Browser lu tidak support Geolocation bro!', 'GPS Error', '❌');
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

function addJitter(storeCode) {
    const state = storeStates[storeCode];
    const jittered = addGPSJitter(state.gpsLat, state.gpsLng);
    state.gpsLat = jittered.lat;
    state.gpsLng = jittered.lng;
    syncGPSUI(storeCode);
    autoAdvanceSection(storeCode);
}

// Helper: Sync text display + map marker
function syncGPSUI(storeCode) {
    const state = storeStates[storeCode];
    
    // Sync text display
    const textDisplay = document.getElementById(`gps-text-${storeCode}`);
    if (textDisplay) textDisplay.textContent = `${state.gpsLat}, ${state.gpsLng}`;
    
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

async function handleCheckOut(storeCode) {
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
    const state = storeStates[storeCode];
    if (!state || state.isSynced) return;

    const currentCount = state.photos[category].length;
    const remainingSlots = maxFiles - currentCount;

    if (remainingSlots <= 0) {
        await cimoryAlert(`Slot foto ${category} sudah penuh (Max: ${maxFiles}). Hapus foto lama dulu bro.`, "Slot Penuh", "⚠️");
        return;
    }

    const filesArray = Array.from(files).slice(0, remainingSlots);
    
    // Tampilkan loading minor pada tombol (opsional UX)
    console.log(`Processing ${filesArray.length} photos for ${category}...`);
    
    const processedPhotos = [];
    for (const file of filesArray) {
        try {
            const compressed = await compressImage(file);
            const thumbnail = await generateThumbnail(file);
            // Buat versi HD (Blob) untuk dikirim ke Telegram
            let telegramBlob = null;
            try { telegramBlob = await compressImageHD(file); } catch(e) { console.warn('HD compress skip:', e); }
            processedPhotos.push({
                filename: generatePhotoFilename(),
                base64: compressed,
                thumbnail: thumbnail,
                telegramBlob: telegramBlob, // HD Blob untuk Telegram
                timestamp: new Date()
            });
        } catch (err) {
            console.error('Error processing photo:', err);
        }
    }
    
    // SEKARANG: Append statt Replace!
    state.photos[category].push(...processedPhotos);
    
    refreshStoreCard(storeCode);
    saveSession();
}


// ============================================
// PAYLOAD GENERATION
// ============================================
function setupPayloadGeneration() {
    btnUpload.addEventListener('click', handleUploadWithValidation);
}

// ============================================
// VALIDATION INTERCEPTOR (Upload Guard)
// ============================================
async function handleUploadWithValidation() {
    if (!storeStates || Object.keys(storeStates).length === 0) return;
    
    const allCodes = Object.keys(storeStates);
    const pendingStores = allCodes.filter(code => storeStates[code].status !== 'checked-out');
    
    if (pendingStores.length > 0) {
        const pendingNames = pendingStores.map(code => {
            const state = storeStates[code];
            const name = state.storeData?.RKMD?.NamaCustomer || state.storeData?.NamaCustomer || code;
            return `  • ${name} (${code})`;
        }).join('\n');
        
        const proceed = await cimoryConfirm(
            `ADA ${pendingStores.length} TOKO YANG BELUM SELESAI!\n\n` +
            `Toko belum di-check-out:\n${pendingNames}\n\n` +
            `Yakin mau setor data sekarang? Toko yang belum selesai tidak akan ikut terupload.`,
            "⚠️ PERINGATAN UPLOAD",
            "⚠️"
        );
        if (!proceed) return;
    }
    
    // All good, lanjut ke upload handler asli
    handleDualApiUpload();
}



// ============================================
// CUSTOM DIALOD SYSTEM (ALERT/CONFIRM)
// ============================================

/**
 * Pengganti window.alert() - Modern & Aesthetic
 */
window.cimoryAlert = function(message, title = 'Informasi', icon = 'ℹ️') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('custom-dialog');
        const titleEl = document.getElementById('dialog-title');
        const msgEl = document.getElementById('dialog-message');
        const iconEl = document.getElementById('dialog-icon');
        const btnCancel = document.getElementById('dialog-btn-cancel');
        const btnOk = document.getElementById('dialog-btn-ok');

        titleEl.textContent = title;
        msgEl.textContent = message;
        iconEl.textContent = icon;
        
        btnCancel.classList.add('hidden'); // Sembunyiin Batal buat Alert
        btnOk.textContent = 'OK';

        dialog.classList.remove('hidden');

        const handleOk = () => {
            dialog.classList.add('hidden');
            btnOk.removeEventListener('click', handleOk);
            resolve();
        };

        btnOk.addEventListener('click', handleOk);
    });
};

/**
 * Pengganti window.confirm() - Modern & Aesthetic
 */
window.cimoryConfirm = function(message, title = 'Konfirmasi', icon = '❓') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('custom-dialog');
        const titleEl = document.getElementById('dialog-title');
        const msgEl = document.getElementById('dialog-message');
        const iconEl = document.getElementById('dialog-icon');
        const btnCancel = document.getElementById('dialog-btn-cancel');
        const btnOk = document.getElementById('dialog-btn-ok');

        titleEl.textContent = title;
        msgEl.textContent = message;
        iconEl.textContent = icon;
        
        btnCancel.classList.remove('hidden'); // Munculin Batal buat Confirm
        btnOk.textContent = 'OKE';

        dialog.classList.remove('hidden');

        const onOk = () => {
            dialog.classList.add('hidden');
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            dialog.classList.add('hidden');
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
        };

        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
    });
};

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
            CheckOutLongitude: state.gpsLng,
            // Skip Visit Fields
            ReasonTime: formatLocalISO(state.skipTime),
            Reason: state.reasonText || "",
            KodeAlasan: state.reasonCode || "",
            ReasonLatitude: state.reasonLat || 0,
            ReasonLongitude: state.reasonLng || 0
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
// TELEGRAM BOT REPORTER
// ============================================

/**
 * Kirim foto HD satu store ke grup Telegram.
 * Dipanggil fire-and-forget (nggak ngeblok upload server).
 */
async function sendStorePhotosToTelegram(storeCode, state) {
    if (typeof TELEGRAM_ENABLED === 'undefined' || !TELEGRAM_ENABLED) return;
    if (typeof TELEGRAM_BOT_TOKEN === 'undefined' || TELEGRAM_BOT_TOKEN.includes('ISI_')) return;

    const storeName = state.storeData?.NamaCustomer || state.storeData?.RKMD?.NamaCustomer || storeCode;
    const checkIn  = state.checkInTime  ? new Date(state.checkInTime).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '-';
    const checkOut = state.checkOutTime ? new Date(state.checkOutTime).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '-';

    // Kumpulkan semua blob HD dari semua kategori
    const blobs = [];
    ['checkin', 'before', 'after'].forEach(cat => {
        (state.photos[cat] || []).forEach(p => {
            if (p.telegramBlob) blobs.push({ blob: p.telegramBlob, category: cat, filename: p.filename });
        });
    });

    if (blobs.length === 0) return; // Tidak ada foto, skip

    const apiBase = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    const caption = `📍 *${storeName}* (${storeCode})\n🕐 Check-In: ${checkIn} | Check-Out: ${checkOut}`;

    // Telegram sendMediaGroup max 10 foto, split jika lebih
    const chunks = [];
    for (let i = 0; i < blobs.length; i += 10) chunks.push(blobs.slice(i, i + 10));

    for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('parse_mode', 'Markdown');

        const media = chunk.map((item, idx) => {
            const fieldName = `photo_${idx}`;
            formData.append(fieldName, item.blob, item.filename);
            return {
                type: 'photo',
                media: `attach://${fieldName}`,
                // Caption hanya di foto pertama chunk pertama
                ...(c === 0 && idx === 0 ? { caption, parse_mode: 'Markdown' } : {})
            };
        });
        formData.append('media', JSON.stringify(media));

        try {
            const res = await fetch(`${apiBase}/sendMediaGroup`, { method: 'POST', body: formData });
            if (!res.ok) {
                const err = await res.json();
                console.warn(`Telegram sendMediaGroup gagal (chunk ${c+1}):`, err.description);
            } else {
                console.log(`✅ Telegram: ${chunk.length} foto terkirim untuk ${storeCode} (chunk ${c+1})`);
            }
        } catch(e) {
            console.warn('Telegram fetch error:', e);
        }
    }
}

// ============================================
// DUAL-API UPLOAD LOGIC
// ============================================
async function handleDualApiUpload() {
    // Only upload stores that are checked-out AND NOT yet synced/uploaded
    const activeStores = Object.keys(storeStates).filter(code => 
        (storeStates[code].status === 'checked-out' || storeStates[code].status === 'skipped') && !storeStates[code].isSynced
    );
    
    if (activeStores.length === 0) {
        await cimoryAlert('Tidak ada toko baru yang siap diupload.\n(Toko yang sudah sukses terupload akan dilewati)', 'Info Upload', 'ℹ️');
        return;
    }

    if (!await cimoryConfirm(`Siap mengirim ${activeStores.length} data kunjungan TOKO BARU ke server?`, 'Konfirmasi Upload', '🚀')) {
        return;
    }

    // --- Tampilkan Global Loader ---
    const loader = document.getElementById('global-loader');
    const loaderTitle = document.getElementById('loader-title');
    const loaderText = document.getElementById('loader-text');
    const loaderBar = document.getElementById('loader-progress-bar');
    const loaderPct = document.getElementById('loader-progress-text');
    
    if (loader) {
        loaderTitle.textContent = 'Mengirim Data...';
        loaderText.textContent = `Menyiapkan ${activeStores.length} data kunjungan...`;
        loaderBar.style.width = '0%';
        loaderPct.textContent = '0%';
        loader.classList.remove('hidden');
    }

    btnUpload.disabled = true;
    btnUpload.innerHTML = '<span class="btn-icon">⏳</span> Uploading...';

    const totalStores = activeStores.length;
    let successStores = 0;
    let hasError = false;
    let lastError = '';

    const updateUIProgress = (pct, mainTitle, subDesc) => {
        if (loaderBar) loaderBar.style.width = `${pct}%`;
        if (loaderPct) loaderPct.textContent = `${Math.round(pct)}%`;
        if (mainTitle) loaderTitle.textContent = mainTitle;
        if (subDesc) loaderText.textContent = subDesc;
    };

    // Process each store
    for (let i = 0; i < totalStores; i++) {
        const storeCode = activeStores[i];
        const state = storeStates[storeCode];
        const storeName = state.storeData?.NamaCustomer || state.storeData?.RKMD?.NamaCustomer || storeCode;
        
        try {
            const basePct = (i / totalStores) * 100;
            const stepPct = 100 / totalStores; 
            
            updateUIProgress(basePct + (stepPct * 0.2), `📤 [${i+1}/${totalStores}] ${storeName}`, 'Mengirim Data Kunjungan...');
            await uploadStoreData(storeCode);
            
            const photos = buildPhotoPayload(storeCode, state);
            if (photos.length > 0) {
                let successPhotoCount = 0;
                const uploadPromises = photos.map((p, idx) => 
                    uploadPhoto(p).then(() => {
                        successPhotoCount++;
                        const currentStorePhotoPct = (successPhotoCount / photos.length) * (stepPct * 0.8);
                        updateUIProgress(basePct + (stepPct * 0.2) + currentStorePhotoPct, null, `Mengirim Foto (${successPhotoCount}/${photos.length})...`);
                    })
                );
                await Promise.all(uploadPromises);
            }
            
            state.isSynced = true;
            state.status = 'checked-out';
            saveSession(); 
            successStores++;

            // Fire-and-forget ke Telegram (nggak ngeblok, gagal pun ga masalah)
            sendStorePhotosToTelegram(storeCode, state).catch(e => console.warn('Telegram skip:', e));
        } catch (error) {
            console.error(`Upload failed for ${storeCode}:`, error);
            hasError = true;
            lastError = error.message;
        }
    }
    
    // Selesai, sembunyikan loader
    if (loader) loader.classList.add('hidden');
    
    renderStoreCards();
    showUploadModalResult(successStores, totalStores, hasError, lastError);

    btnUpload.disabled = false;
    btnUpload.innerHTML = '<span class="btn-icon">🚀</span> Upload to Server';
    updateStoresCount(); 

    // --- AUTO VERIFICATION ---
    if (successStores > 0 && VERIFICATION_ENABLED) {
        setTimeout(() => {
            runAutoVerification(false);
        }, 1500); // Tunggu sebentar biar server SIAP-nya napas dulu
    }
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
    const url = getDmsUrl("/api/sfaservice/checkoutpostlater");
    const response = await fetch(url, {
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

    const url = getDmsUrl("/api/sfaservice/uploadpict");
    const response = await fetch(url, {
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
    const pending  = total - uploaded - ready;

    const el = document.getElementById('stores-count');
    if (el) {
        el.classList.remove('hidden');
        el.innerHTML = [
            `<span class="count-item">📋 <b>${total}</b> toko</span>`,
            ready > 0    ? `<span class="count-item ready">✅ <b>${ready}</b> siap upload</span>` : '',
            uploaded > 0 ? `<span class="count-item uploaded">☁️ <b>${uploaded}</b> terupload</span>` : '',
            pending > 0  ? `<span class="count-item pending">⏳ <b>${pending}</b> belum</span>` : '',
        ].join('');
    }

    // Tombol upload hanya aktif kalau ada yang siap
    if (btnUpload) {
        btnUpload.disabled = ready === 0;
        btnUpload.style.opacity = ready === 0 ? '0.45' : '1';
    }
}



// ============================================
// SERVER VERIFICATION MODULE (SIAP SCRAPING)
// ============================================

/**
 * Melakukan login ke sistem SIAP Cimory untuk mendapatkan session cookie.
 */
async function loginToCimorySIAP() {
    if (!VERIFICATION_ENABLED || !SIAP_USERNAME || !SIAP_PASSWORD) {
        console.warn("[VERIFY] Konfigurasi login SIAP belum lengkap.");
        return false;
    }

    try {
        console.log("[VERIFY] Mencoba login ke SIAP Cimory...");
        
        // STEP 1: Ambil halaman login dulu buat nyolong nilai "ip" (Hidden field)
        // Tambah cache-buster biar ga kena cache CORS lama bro
        const loginPageUrl = getDmsUrl(`/siap/Login?_=${Date.now()}`);
        const getLoginRes = await fetch(loginPageUrl, { credentials: 'include' });
        const loginHtml = await getLoginRes.text();
        
        // Scraping nilai IP dari <input type="hidden" name="ip" value="...">
        const ipMatch = loginHtml.match(/name=["']ip["']\s+value=["']([^"']+)["']/i);
        const ipValue = ipMatch ? ipMatch[1] : "";
        
        console.log(`[VERIFY] Hidden IP found: ${ipValue || "not found"}`);

        // STEP 2: Tembak endpoint logincek yang bener
        const logincekUrl = getDmsUrl("/siap/Login/logincek");
        
        // Encode payload login (Urutan IP dulu baru username sesuai test.py)
        const params = new URLSearchParams();
        if (ipValue) params.append('ip', ipValue);
        params.append('username', SIAP_USERNAME);
        params.append('password', SIAP_PASSWORD);

        const response = await fetch(logincekUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params,
            redirect: 'follow', // Kita ikutin alurnya
            credentials: 'include'
        });

        if (!response.ok) throw new Error(`Login failed: ${response.status}`);
        
        // Deteksi login berhasil (Nyontek Python): 
        // 1. Cek URL tujuan (Redirect)
        // 2. Cek Header 'Refresh' (Sering dipake SIAP)
        // 3. Cek isi HTML
        const finalUrl = response.url;
        const refreshHeader = response.headers.get('Refresh') || "";
        const html = await response.text();
        
        const isSuccess = finalUrl.includes('/siap/Home') || 
                          refreshHeader.includes('Home') ||
                          html.includes('welcome') || 
                          html.includes('Home') || 
                          html.includes('Beranda');

        if (isSuccess) {
            console.log("[VERIFY] Login SIAP Berhasil! ✅");
            return true;
        } else {
            console.error("[VERIFY] Login SIAP Gagal: Username/Password salah atau di-reject server.");
            // Log tambahan buat debug di konsol user
            console.log("[DEBUG] Final URL:", finalUrl);
            console.log("[DEBUG] Refresh Header:", refreshHeader);
            return false;
        }
    } catch (err) {
        console.error("[VERIFY] Error saat login SIAP:", err);
        return false;
    }
}

/**
 * Mengambil data verifikasi (scraping) dari halaman Detail Visit MDS.
 */
async function fetchServerVerificationData() {
    // 1. Ambil Kode MDS dari file RKM atau local storage
    let mdsCode = rkmData?.RKMHeader?.KodeMerchandiser?.trim();
    if (!mdsCode) {
        console.warn("[VERIFY] Kode MDS tidak ditemukan di file RKM.");
        return null;
    }

    try {
        // Format tanggal hari ini (YYYY-MM-DD buat endpoint fetch)
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        console.log(`[VERIFY] Menarik data verifikasi untuk MDS ${mdsCode} tanggal ${todayStr}...`);
        
        const url = getDmsUrl(`/siap/visitmds/fetch`);
        
        // Payload sesuai riset network log
        const params = new URLSearchParams();
        params.append('limit', '50');
        params.append('start', '0');
        params.append('kode_mds', mdsCode);
        params.append('tanggal_rkm', todayStr);
        params.append('asiscode', ASIS_CODE || 'ASIS_SIAP_JKT');

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params,
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        
        const htmlFragment = await response.text();
        return parseVerificationHTML(htmlFragment);
    } catch (err) {
        console.error("[VERIFY] Error saat narik data verifikasi:", err);
        return null;
    }
}

/**
 * Logika Scraping: Mencari status kunjungan dari HTML tabel SIAP.
 */
function parseVerificationHTML(html) {
    const parser = new DOMParser();
    // Bungkus fragment dalem table biar parsing valid
    const doc = parser.parseFromString(`<table>${html}</table>`, 'text/html');
    const verificationResults = {};

    // Strategi Python: Cari semua link modal yang punya atribut data-kode_cus
    const modalLinks = doc.querySelectorAll('a.open_modal');
    
    modalLinks.forEach(link => {
        const kodeCust = link.getAttribute('data-kode_cus')?.trim();
        if (!kodeCust) return;

        // Cari baris (tr) tempat link ini berada
        const row = link.closest('tr');
        if (!row) return;

        const cols = row.querySelectorAll('td');
        // Biasanya Time In ada di kolom ke-4 (index 3), Time Out kolom ke-5 (index 4)
        // Kita cari string jam (HH:mm) di semua kolom biar aman
        let isVisited = false;
        cols.forEach(td => {
            const txt = td.textContent.trim();
            if (/^\d{1,2}:\d{2}$/.test(txt)) {
                isVisited = true;
            }
        });

        verificationResults[kodeCust] = isVisited;
    });

    console.log(`[VERIFY] Berhasil sinkron ${Object.keys(verificationResults).length} status toko.`);
    return verificationResults;
}

/**
 * Fungsi utama Auto-Verification: Login -> Fetch -> Sync UI
 */
async function runAutoVerification(showSilence = true) {
    if (!VERIFICATION_ENABLED) return;

    const btn = document.querySelector('.btn-verify-server');
    if (btn) {
        btn.classList.add('loading');
        btn.innerHTML = '<span class="btn-icon">⏳</span> Sinkronisasi Server...';
    }

    if (!showSilence) {
        showUploadStatus('loading', '🔍 Mengverifikasi data ke server SIAP...');
    }

    try {
        // 1. Login (Cek session)
        const loginOk = await loginToCimorySIAP();
        if (!loginOk) {
            if (!showSilence) showUploadStatus('error', '❌ Verifikasi Gagal: Login SIAP Bermasalah.');
            return;
        }

        // 2. Tarik Data
        const serverData = await fetchServerVerificationData();
        if (!serverData) {
            if (!showSilence) showUploadStatus('error', '❌ Verifikasi Gagal: Data tidak bisa ditarik.');
            return;
        }

        // 3. Update Status Lokal
        let verifiedCount = 0;
        Object.keys(serverData).forEach(kodeCust => {
            if (serverData[kodeCust] && storeStates[kodeCust]) {
                if (!storeStates[kodeCust].isSyncedFromServer) {
                    storeStates[kodeCust].isSyncedFromServer = true;
                    verifiedCount++;
                }
            }
        });

        console.log(`[VERIFY] Sinkronisasi Selesai. ${verifiedCount} toko terverifikasi oleh server.`);
        
        if (verifiedCount > 0) {
            saveSession();
            renderStoreCards();
            if (!showSilence) showUploadStatus('success', `✅ ${verifiedCount} Toko TERVERIFIKASI oleh Server!`);
        } else {
            if (!showSilence) showUploadStatus('info', 'ℹ️ Data sinkron, tidak ada perubahan baru.');
        }
    } catch (err) {
        console.error("[VERIFY] Error during auto-verification:", err);
        if (!showSilence) showUploadStatus('error', '❌ Terjadi kesalahan saat sinkronisasi.');
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.innerHTML = '<span class="btn-icon">📡</span> Cek Verifikasi Server';
        }
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


// ============================================
// EXTRA CALL (ADD STORE)
// ============================================

window.openExtraCallModal = function() {
    const modal = document.getElementById('extra-call-modal');
    if (modal) modal.classList.remove('hidden');
    
    const input = document.getElementById('input-search-extracall');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
    }
    
    // Clear previous results
    const resultCont = document.getElementById('extracall-results');
    if (resultCont) {
        resultCont.innerHTML = `
            <div class="extracall-empty-state">
                <span style="font-size: 40px; display: block; margin-bottom: 10px;">🏘️</span>
                Hasil pencarian bakal muncul di sini...
            </div>
        `;
    }
};

window.closeExtraCallModal = function() {
    const modal = document.getElementById('extra-call-modal');
    if (modal) modal.classList.add('hidden');
};

window.searchExtraCall = async function() {
    const input = document.getElementById('input-search-extracall');
    const query = input?.value?.trim();
    const statusEl = document.getElementById('extracall-status');
    const resultCont = document.getElementById('extracall-results');
    
    if (!query) return;

    // Ambil Kode Merchandiser asli dari RKM yang udah ke-load
    const realMdsCode = getActiveMerchandiserCode();
    
    if (!realMdsCode) {
        await cimoryAlert("Download RKM (Server Sinkron) dulu bro biar sistem tau ID Merchandiser lu!", "Data Belum Lengkap", "⚠️");
        return;
    }

    statusEl.textContent = "⏳ Mencari toko (ID: " + realMdsCode + ")...";
    statusEl.className = "extracall-status loading";
    statusEl.classList.remove('hidden');
    resultCont.innerHTML = '';

    try {
        const url = getDmsUrl("/api/sfaservice/getextracall");
        const payload = {
            Values: [
                { Key: "KODE_MDS", Value: realMdsCode },
                { Key: "FILTER", Value: query }
            ]
        };


        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        statusEl.classList.add('hidden');

        if (data.StatusDownload === "OK" && data.ListDetail) {
            renderExtraCallResults(data.ListDetail);
        } else {
            resultCont.innerHTML = `<div class="extracall-empty-state">❌ ${data.ErrorMessage || "Toko tidak ditemukan"}</div>`;
        }
    } catch (error) {
        console.error("Search failed:", error);
        statusEl.textContent = "❌ Gagal konek ke server (Cek Proxy!)";
        statusEl.className = "extracall-status error";
    }
};

function renderExtraCallResults(list) {
    const resultCont = document.getElementById('extracall-results');
    if (!list || list.length === 0) {
        resultCont.innerHTML = `<div class="extracall-empty-state">Toko tidak ditemukan. Ganti keyword bro!</div>`;
        return;
    }

    resultCont.innerHTML = list.map(item => `
        <div class="extracall-item">
            <div class="eci-info">
                <span class="eci-code">${item.KodeCustomer}</span>
                <span class="eci-name">${item.NamaCustomer}</span>
                <span class="eci-address" title="${item.Alamat01}">${item.Alamat01 || '-'}</span>
            </div>
            <button class="btn-add-eci" onclick="addExtraCall('${item.KodeCustomer}')">
                <span>➕</span> TAMBAH
            </button>
        </div>
    `).join('');
}

window.addExtraCall = async function(kodeCustomer) {
    const realMdsCode = getActiveMerchandiserCode();
    const btn = event.currentTarget;
    const originalHtml = btn.innerHTML;

    if (!realMdsCode) return; // Should not happen if search worked

    btn.disabled = true;
    btn.innerHTML = "⏳..";

    try {
        const url = getDmsUrl("/api/sfaservice/addextracall");
        const payload = {
            Values: [
                { Key: "KODE_MDS", Value: realMdsCode },
                { Key: "KODE_CUS", Value: kodeCustomer }
            ]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.StatusDownload === "OK" && data.ListRKMDetail) {
            // "Sat-set" Injection!
            processExtraCallData(data);
            
            // Success UX
            btn.innerHTML = "✅ OKE";
            setTimeout(() => {
                closeExtraCallModal();
                // Scroll ke paling bawah biar keliatan
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }, 800);
        } else {
            await cimoryAlert("Gagal nambah toko: " + (data.ErrorMessage || "Udah ada di list?"), "Gagal Tambah Toko", "❌");
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    } catch (error) {
        console.error("Add Extra Call failed:", error);
        await cimoryAlert("Error koneksi!", "Connection Error", "❌");
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
};

function processExtraCallData(payload) {
    // payload is DownloadExtraCallModel
    payload.ListRKMDetail.forEach(item => {
        const d = item.RKMD;
        const storeCode = d.KodeCustomer;
        
        // Cek kalau udah ada
        if (storeStates[storeCode]) return;

        // Bikin state baru sesuai dengan struktur RPS RKM yang baru
        storeStates[storeCode] = {
            storeData: item,
            checkInTime: null,
            checkOutTime: null,
            gpsLat: parseFloat(d.Latitude || 0),
            gpsLng: parseFloat(d.Longitude || 0),
            photos: { checkin: [], before: [], after: [] },
            stockData: [], // Bakal diisi dari ListRKMStok
            status: 'pending',
            isExpanded: false,
            openSection: 'gps',
            isSynced: false
        };

        // Fill stock baseline if present from extra call payload
        let stockItems = [];
        if (payload.ListRKMStok) {
            stockItems = payload.ListRKMStok.filter(s => s.KodeCustomer === storeCode)
                .map(s => {
                    return {
                        ...s,
                        JumSatuan: 0,
                        JumKarton: 0,
                        JumPcsE: 0
                    };
                });
        }
        
        // Panggil fungsi global stock updater biar sinkron sama stok online jika ada
        storeStates[storeCode].stockData = stockItems;
    });

    // Panggil helper ulang sinkronisasi stok
    loadAllStockData();

    // Refresh UI
    renderStoreCards();
    saveSession(); // Persist the new store
}

// Helper buat dapetin ID Merchandiser asli dari data RKM yang udah ke-load
function getActiveMerchandiserCode() {
    // Coba cari dari list toko yang ada
    for (const storeCode in storeStates) {
        const mds = storeStates[storeCode]?.storeData?.RKMD?.KodeMerchandiser;
        if (mds) return mds.trim();
    }
    
    // Fallback: cek rkmData langsung
    if (rkmData && rkmData.ListRKMDetail && rkmData.ListRKMDetail.length > 0) {
        return rkmData.ListRKMDetail[0].RKMD.KodeMerchandiser.trim();
    }
    
    return null;
}

// ============================================
// SKIP VISIT (TIDAK DIKUNJUNGI)
// ============================================

let currentSkipStoreCode = null;

window.openSkipModal = function(storeCode) {
    currentSkipStoreCode = storeCode;
    const modal = document.getElementById('skip-visit-modal');
    const select = document.getElementById('select-skip-alasan');
    const reasonText = document.getElementById('input-skip-reason');
    
    if (modal) modal.classList.remove('hidden');
    if (reasonText) reasonText.value = '';

    // Populate Reasons from LocalStorage
    const reasonsRaw = localStorage.getItem('DMS_REASONS');
    if (reasonsRaw && select) {
        const reasons = JSON.parse(reasonsRaw);
        select.innerHTML = '<option value="">- Belum dipilih -</option>' + 
            reasons.map(r => `<option value="${r.KodeAlasan}">${r.NamaAlasan}</option>`).join('');
    } else {
        select.innerHTML = '<option value="">(Error: Data Alasan Kosong!)</option>';
    }
};

window.closeSkipModal = function() {
    const modal = document.getElementById('skip-visit-modal');
    if (modal) modal.classList.add('hidden');
};

window.submitSkipVisit = async function() {
    if (!currentSkipStoreCode) return;

    const select = document.getElementById('select-skip-alasan');
    const reasonInput = document.getElementById('input-skip-reason');
    const btn = document.getElementById('btn-save-skip');
    
    const reasonCode = select.value;
    const reasonText = reasonInput.value.trim();

    if (!reasonCode) {
        await cimoryAlert("Pilih alasan resminya dulu bro!", "Form Belum Lengkap", "⚠️");
        return;
    }
    if (!reasonText) {
        await cimoryAlert("Kasih keterangan dikit lah bro biar admin nggak nanya-nanya!", "Form Belum Lengkap", "⚠️");
        return;
    }

    btn.disabled = true;
    btn.textContent = "⏳ Menyimpan...";

    try {
        // Nangkep kordinat terakhir (pake store kordinat kalo GPS alat error)
        let lat = currentLat || storeStates[currentSkipStoreCode]?.gpsLat || 0;
        let lng = currentLng || storeStates[currentSkipStoreCode]?.gpsLng || 0;

        // Update State
        storeStates[currentSkipStoreCode].status = 'skipped';
        storeStates[currentSkipStoreCode].skipTime = new Date();
        storeStates[currentSkipStoreCode].reasonCode = reasonCode;
        storeStates[currentSkipStoreCode].reasonText = reasonText;
        storeStates[currentSkipStoreCode].reasonLat = lat;
        storeStates[currentSkipStoreCode].reasonLng = lng;

        // Save & Refresh
        saveSession();
        renderStoreCards(); // Updated from renderStores()
        
        closeSkipModal();
        await cimoryAlert("Sip bro, status toko berhasil diupdate jadi 'Terlewati'.", "Sukses Update", "✅");
    } catch (e) {
        console.error("Skip Visit failed:", e);
        await cimoryAlert("Gagal update status!", "Error", "❌");
    } finally {
        btn.disabled = false;
        btn.textContent = "SIMPAN ALASAN";
    }
};

// ============================================
// SERVER VERIFICATION LOGIC (NEW v3.1)
// ============================================

// Fungsi buat login ke SIAP lewat Proxy
async function loginToSiap() {
    try {
        console.log("[Verification] Scraping login page for hidden IP...");
        
        // Coba ambil cookie lama dari storage kalo ada
        let currentSiapCookie = localStorage.getItem('SIAP_MANUAL_COOKIE') || "";

        const getLoginRes = await fetch(getDmsUrl("/siap/Login", currentSiapCookie), { 
            credentials: 'include' 
        });
        
        // Simpan cookie baru kalo ada dari header X-Set-Cookie
        const setCookieManual = getLoginRes.headers.get('X-Set-Cookie');
        console.log("[Verification] X-Set-Cookie from Login Page:", setCookieManual);
        if (setCookieManual) {
            currentSiapCookie = updateManualCookie(currentSiapCookie, setCookieManual);
            localStorage.setItem('SIAP_MANUAL_COOKIE', currentSiapCookie);
            console.log("[Verification] Cookie updated internally.");
        }

        const loginHtml = await getLoginRes.text();
        
        // Cari field IP (Hidden)
        const ipMatch = loginHtml.match(/name=["']ip["']\s+value=["']([^"']+)["']/i);
        const ipValue = ipMatch ? ipMatch[1] : "172.71.81.27";
        console.log("[Verification] Found IP:", ipValue);

        const urlLoginCek = getDmsUrl("/siap/Login/logincek");
        const payload = new URLSearchParams();
        payload.append('ip', ipValue);
        payload.append('username', getSiapCredentials().username);
        payload.append('password', getSiapCredentials().password);

        const response = await fetch(getDmsUrl("/siap/Login/logincek", currentSiapCookie), {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: payload,
            redirect: 'follow',
            credentials: 'include' 
        });

        const refreshHeader = response.headers.get('Refresh');
        const finalUrl = response.url;
        const html = await response.text();
        
        // Update cookie lagi dari logincek
        const setCookieLogin = response.headers.get('X-Set-Cookie');
        if (setCookieLogin) {
            currentSiapCookie = updateManualCookie(currentSiapCookie, setCookieLogin);
            localStorage.setItem('SIAP_MANUAL_COOKIE', currentSiapCookie);
        }

        if (refreshHeader && refreshHeader.includes('Home')) {
            console.log("[Verification] Follow-up Refresh header to /siap/Home...");
            const homeRes = await fetch(getDmsUrl("/siap/Home", currentSiapCookie), { 
                credentials: 'include' 
            });
            const setCookieHome = homeRes.headers.get('X-Set-Cookie');
            if (setCookieHome) {
                currentSiapCookie = updateManualCookie(currentSiapCookie, setCookieHome);
                localStorage.setItem('SIAP_MANUAL_COOKIE', currentSiapCookie);
            }
        }

        const isSuccess = finalUrl.includes('/Home') || html.toLowerCase().includes('welcome') || (refreshHeader && refreshHeader.includes('Home'));
        
        if (isSuccess) {
            console.log("[Verification] Login SIAP Berhasil! ✅");
            return true;
        } else {
            console.error("[Verification] Login GAGAL (Check credentials/IP).");
            return false;
        }
    } catch (err) {
        console.error("[Verification] Login Exception:", err);
        return false;
    }
}

// Helper buat gabungin cookie baru ke cookie string lama
function updateManualCookie(oldCookie, newCookieStr) {
    const cookieMap = {};
    
    // Parse old
    if (oldCookie) {
        oldCookie.split(';').forEach(c => {
            const [k, v] = c.split('=').map(s => s.trim());
            if (k && v) cookieMap[k] = v;
        });
    }
    
    // Parse new (Set-Cookie format can be multiple name=value sequences)
    if (newCookieStr) {
        newCookieStr.split(';').forEach(c => {
            const [k, v] = c.split('=').map(s => s.trim());
            if (k && v && !['path', 'domain', 'samesite', 'secure', 'httponly'].includes(k.toLowerCase())) {
                cookieMap[k] = v;
            }
        });
    }
    
    return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
}

window.syncServerVerification = async function() {
    const btn = document.getElementById('btn-sync-server');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon spin">🔄</span> Sedang Login...';
    }

    try {
        // 1. LOGIN DULU BRO!
        await loginToSiap();
        
        if (btn) btn.innerHTML = '<span class="btn-icon spin">🔄</span> Sedang Kroscek...';

        const mdsCode = getActiveMerchandiserCode();
        if (!mdsCode) {
            await cimoryAlert("Gak ketemu Kode MDS-nya bro. Coba load RKM dulu!", "Gagal Verifikasi", "⚠️");
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const asisCode = (typeof ASIS_CODE !== 'undefined') ? ASIS_CODE : 'ASIS_SIAP_JKT';

        const payload = new URLSearchParams();
        payload.append('limit', '100'); // Naikkan limit biar aman
        payload.append('start', '0');
        payload.append('kode_mds', mdsCode);
        payload.append('tanggal_rkm', today);
        payload.append('asiscode', asisCode);

        // Kasih delay dikit biar session-nya "mateng" di server
        await new Promise(r => setTimeout(r, 1500));

        // Ambil cookie manual
        const manualCookie = localStorage.getItem('SIAP_MANUAL_COOKIE') || "";

        const response = await fetch(getDmsUrl("/siap/visitmds/fetch", manualCookie), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: payload,
            credentials: 'include'
        });

        if (!response.ok) throw new Error("Server SIAP lagi bapuk atau proxy bermasalah.");

        const htmlFragment = await response.text();
        console.log("[Verification] Raw Response Preview:", htmlFragment.substring(0, 250));
        
        // Cek apakah responnya beneran data atau disuruh login lagi
        if (htmlFragment.length < 50 || htmlFragment.includes("Login") || htmlFragment.includes("login")) {
             console.warn("[Verification] Data kosong atau diarahkan ke Login. Mencoba paksa login ulang...");
             // Kalo zonk, mungkin butuh login ulang yang bener-bener fresh
        }
        
        const results = parseVerificationHTML(htmlFragment);
        
        console.log("[Verification] Found on server:", results);

        // Update Store States
        let verifiedCount = 0;
        const localStoreCodes = Object.keys(storeStates);
        
        for (const storeCode of localStoreCodes) {
            // Trim biar gak keganggu spasi dari server
            const serverData = results.find(r => r.kode_cus.trim() === storeCode.trim());
            
            if (serverData) {
                console.log(`[Verification] Match found for ${storeCode}: In=${serverData.time_in}, Out=${serverData.time_out}`);
                
                if (serverData.time_out !== 'N/A' && serverData.time_out !== '') {
                    // Berhasil Verifikasi!
                    storeStates[storeCode].isSyncedFromServer = true;
                    storeStates[storeCode].serverTimeOut = serverData.time_out;
                    verifiedCount++;
                }
            } else {
                console.log(`[Verification] No server data for ${storeCode}`);
            }
        }

        if (verifiedCount > 0) {
            saveSession();
            renderStoreCards();
            await cimoryAlert(`Mantap bro! ${verifiedCount} toko berhasil terverifikasi sinkron sama server SIAP.`, "Sinkronisasi Berhasil", "✅");
        } else {
            await cimoryAlert("Belum ada data toko yang kelar (Check-Out) di server buat hari ini.", "Server Belum Update", "ℹ️");
        }

    } catch (err) {
        console.error("[Verification] Error:", err);
        await cimoryAlert("Gagal nembak server SIAP. Coba lagi nanti atau cek koneksi proxy lu.", "Error Koneksi", "❌");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">🔄</span> Cek Verifikasi Server';
        }
    }
};

function parseVerificationHTML(html) {
    const parser = new DOMParser();
    // Wrap in a div to facilitate overall selection
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const rows = doc.querySelectorAll('tr');
    
    const visits = [];
    let currentIn = "N/A";
    let currentOut = "N/A";
    let currentName = "N/A";
    
    rows.forEach(row => {
        const text = row.textContent.trim();
        
        // 1. Cari Customer Name
        if (text.includes("Customer Name")) {
            try {
                const parts = text.split(":");
                if (parts.length > 1) {
                    currentName = parts[1].split("Status")[0].trim();
                }
            } catch(e) {}
        }

        // 2. Cari Time In
        if (text.includes("Time In")) {
            const match = text.match(/Time In\s*:\s*(\d{1,2}:\d{2}(:\d{2})?)/i);
            if (match) currentIn = match[1];
        }

        // 3. Cari Time Out
        if (text.includes("Time Out")) {
            const match = text.match(/Time Out\s*:\s*(\d{1,2}:\d{2}(:\d{2})?)/i);
            if (match) currentOut = match[1];
        }

        // 4. Cari Modal Link (yang berisi Kode Cus)
        const modalLink = row.querySelector('a.open_modal');
        if (modalLink) {
            const kodeCus = (modalLink.getAttribute('data-kode_cus') || "").trim();
            
            // Cek apakah kode_cus ini sudah pernah kita catat di blok ini
            // (Satu toko bisa punya banyak foto, kita cuma butuh sekali)
            const existing = visits.find(v => v.kode_cus === kodeCus);
            if (kodeCus && !existing) {
                visits.push({
                    kode_cus: kodeCus,
                    cust_name: currentName,
                    time_in: currentIn,
                    time_out: currentOut
                });
            }
        }
    });
    
    return visits;
}
