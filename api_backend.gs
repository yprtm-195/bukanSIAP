// ============================================
// API STORE_MASTER CIMORY (VERSI CLOUD API)
// File ini adalah backup/master code untuk di-paste ke Google Apps Script
// ============================================

const SPREADSHEET_ID = "1Em5vlkdqGMFwvgSrmOVxTR6sRxFjalQoWSCeGOAeza4";
const SHEET_PRODUK = "Daftar Produk";
const SHEET_TOKO = "Daftar Toko";
const SHEET_HARGA = "Data Harga Terkini";

function doGet(e) {
  try {
    // Buka spreadsheet by ID biar ga bergantung sama aktif/engganya sheet
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID); 
    
    // 1. BEKAL 1: KAMUS PRODUK (Dari Sheet "Daftar Produk")
    const sheetProduk = ss.getSheetByName(SHEET_PRODUK);
    if (!sheetProduk) throw new Error("Sheet '" + SHEET_PRODUK + "' gak ketemu bro!");
    
    const dataProduk = sheetProduk.getDataRange().getValues();
    const mapProduk = {}; 
    
    // Mulai baris ke-2 (index 1) karena baris ke-1 anggap header
    for(let i = 1; i < dataProduk.length; i++) {
      const nama = (dataProduk[i][1] || "").toString().trim(); // Kolom B
      const kode = (dataProduk[i][2] || "").toString().trim(); // Kolom C
      if(nama && kode) mapProduk[nama] = kode;
    }
    
    // 2. BEKAL 2: KAMUS TOKO (Dari Sheet "Daftar Toko")
    const sheetToko = ss.getSheetByName(SHEET_TOKO);
    if (!sheetToko) throw new Error("Sheet '" + SHEET_TOKO + "' gak ketemu bro!");
    
    const dataToko = sheetToko.getDataRange().getValues();
    const masterToko = {};
    
    for(let i = 1; i < dataToko.length; i++) {
      const kodeToko = (dataToko[i][0] || "").toString().trim(); // Kolom A
      const lat = parseFloat(dataToko[i][7]) || 0;                // Kolom H
      const lng = parseFloat(dataToko[i][8]) || 0;                // Kolom I
      if(kodeToko) {
        masterToko[kodeToko] = { lat: lat, lng: lng, products: [] };
      }
    }
    
    // 3. JAHIT DATA (Dari Sheet "Data Harga Terkini")
    const sheetHarga = ss.getSheetByName(SHEET_HARGA);
    if (!sheetHarga) throw new Error("Sheet '" + SHEET_HARGA + "' gak ketemu bro!");
    
    const dataHarga = sheetHarga.getDataRange().getValues();
    
    for(let i = 1; i < dataHarga.length; i++) {
      const kodeToko = (dataHarga[i][1] || "").toString().trim();   // Kolom B
      const namaProduk = (dataHarga[i][5] || "").toString().trim(); // Kolom F
      const hargaNormal = parseFloat(dataHarga[i][6]) || 0;         // Kolom G
      
      // Syarat Lulus: Harga > 0, Toko Tercatat, Nama Produk Ada
      if (hargaNormal > 0 && kodeToko && namaProduk) {
        
        const kodeProdukRKM = mapProduk[namaProduk] || ""; // Terjemahin nama ke kode RKM
        
        if (kodeProdukRKM) {
          if (!masterToko[kodeToko]) {
            masterToko[kodeToko] = { lat: 0, lng: 0, products: [] };
          }
          if (masterToko[kodeToko].products.indexOf(kodeProdukRKM) === -1) {
            masterToko[kodeToko].products.push(kodeProdukRKM);
          }
        }
      }
    }
    
    // 4. BALIKIN JSON KE APLIKASI
    const resultJSON = {
      status: "success",
      totalToko: Object.keys(masterToko).length,
      data: masterToko
    };
    
    return ContentService.createTextOutput(JSON.stringify(resultJSON))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Kalau ada sheet yang namanya beda atau koding rusak, bakal nge-return Error
    // biar bisa dibaca di Log aplikasi HP.
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}
