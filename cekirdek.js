/* ═══════════════════════════════════════════════════════════════════════════
 *  BÜTÇEM Telefon — ÇEKİRDEK (ekrandan bağımsız mantık)        Sürüm 1 — 04.10.2026
 *  Tutar/tarih çevirme, kayıt doğrulama, bekleme kuyruğu, gönderme, listeler.
 *  Bütün veriler telefonun kendi hafızasında (localStorage) durur.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (kok) {
  'use strict';

  const ANAHTAR_AYAR   = 'butcem_ayar';      // {url, anahtar, cihaz}
  const ANAHTAR_KUYRUK = 'butcem_kuyruk';    // gönderilmeyi bekleyen kayıtlar
  const ANAHTAR_GECMIS = 'butcem_gecmis';    // son gönderilenler (yalnız bilgi)
  const ANAHTAR_LISTE  = 'butcem_listeler';  // BÜTÇEM'den gelen hesap/kategori
  const ANAHTAR_SON    = 'butcem_son';       // tür başına son seçilen hesaplar
  const GECMIS_SINIR   = 50;
  const TURLER         = ['gider', 'gelir', 'transfer'];

  // ── Depo ──────────────────────────────────────────────────────────────────
  function oku(depo, ad, varsayilan) {
    try {
      const v = depo.getItem(ad);
      return v ? JSON.parse(v) : varsayilan;
    } catch (e) {
      return varsayilan;
    }
  }
  function yaz(depo, ad, deger) {
    depo.setItem(ad, JSON.stringify(deger));
  }

  // ── Tutar ─────────────────────────────────────────────────────────────────
  // Türkçe yazım: "2.500" = iki bin beş yüz, "2.500,75" ya da "2500,75".
  // NOKTA her zaman binlik ayıracı, VİRGÜL ondalık sayılır (iPhone'un Türkçe
  // sayı klavyesi virgül verir). Ekranda sonucu gösterdiğimiz için yanlış
  // yorum hemen görülür.
  function tutarCoz(metin) {
    const s = String(metin == null ? '' : metin).replace(/\s|TL|₺/gi, '');
    if (!s) return NaN;
    // Noktalar yalnız doğru yerdeyse binlik sayılır ("2.500", "12.500,75").
    // "12.5" gibi belirsiz yazımlar REDDEDİLİR → ekranda "anlaşılamadı" çıkar,
    // kullanıcı virgülle yazar. Yanlış tutarın sessizce kaydedilmesinden iyidir.
    const noktali = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
    const duz     = /^\d+(,\d{1,2})?$/;
    if (!noktali.test(s) && !duz.test(s)) return NaN;
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return Math.round(n * 100) / 100;
  }
  function tutarYaz(n) {
    if (!isFinite(n)) return '';
    const sabit = Math.abs(n).toFixed(2).split('.');
    const tam = sabit[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + tam + ',' + sabit[1] + ' TL';
  }

  // ── Tarih ─────────────────────────────────────────────────────────────────
  function bugunIso(simdi) {
    const d = simdi || new Date();
    const yerel = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return yerel.toISOString().slice(0, 10);
  }
  function isoDanTr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }

  // ── Kayıt ─────────────────────────────────────────────────────────────────
  function yeniId() {
    if (kok.crypto && typeof kok.crypto.randomUUID === 'function') return kok.crypto.randomUUID();
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /** Sunucudaki kuralların AYNISI. Geçerliyse null, değilse hata metni. */
  function dogrula(k) {
    if (TURLER.indexOf(k.tur) < 0) return 'Tür seçilmedi';
    if (!isFinite(k.tutar) || k.tutar <= 0) return 'Tutarı kontrol et';
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(k.tarih || '')) return 'Tarihi kontrol et';
    if (!String(k.hesap || '').trim()) {
      return k.tur === 'gelir' ? 'Hangi hesaba geldiğini seç'
           : k.tur === 'transfer' ? 'Nereden aktarıldığını seç'
           : 'Hangi hesaptan ödendiğini seç';
    }
    if (k.tur === 'transfer') {
      if (!String(k.hedef_hesap || '').trim()) return 'Nereye aktarıldığını seç';
      if (k.hedef_hesap.trim() === k.hesap.trim()) return 'Kaynak ve hedef aynı olamaz';
    }
    return null;
  }

  /** Formdan gelen ham değerlerden kayıt üretir: {kayit, hata}. */
  function kayitOlustur(form, cihaz) {
    const k = {
      id: yeniId(),
      tur: form.tur,
      tutar: tutarCoz(form.tutar),
      tarih: isoDanTr(form.tarihIso),
      hesap: String(form.hesap || '').trim(),
      hedef_hesap: form.tur === 'transfer' ? String(form.hedef_hesap || '').trim() : '',
      kategori: form.tur === 'gider' ? String(form.kategori || '').trim() : '',
      aciklama: String(form.aciklama || '').trim(),
      cihaz: String(cihaz || '').trim(),
      olusturma: new Date().toISOString()
    };
    const hata = dogrula(k);
    return { kayit: hata ? null : k, hata: hata };
  }

  // ── Kuyruk ────────────────────────────────────────────────────────────────
  function kuyruk(depo) { return oku(depo, ANAHTAR_KUYRUK, []); }
  function gecmis(depo) { return oku(depo, ANAHTAR_GECMIS, []); }

  function kuyrugaEkle(depo, k) {
    const q = kuyruk(depo);
    q.push(k);
    yaz(depo, ANAHTAR_KUYRUK, q);
    const son = oku(depo, ANAHTAR_SON, {});
    son[k.tur] = { hesap: k.hesap, hedef_hesap: k.hedef_hesap };
    yaz(depo, ANAHTAR_SON, son);
  }
  function kuyruktanSil(depo, id) {
    yaz(depo, ANAHTAR_KUYRUK, kuyruk(depo).filter(function (k) { return k.id !== id; }));
  }
  function hatayiTemizle(depo, id) {
    yaz(depo, ANAHTAR_KUYRUK, kuyruk(depo).map(function (k) {
      if (k.id === id) { const y = Object.assign({}, k); delete y.hata; return y; }
      return k;
    }));
  }
  function sonSecim(depo, tur) { return (oku(depo, ANAHTAR_SON, {}))[tur] || {}; }

  // ── Ayar / listeler ───────────────────────────────────────────────────────
  function ayar(depo) { return oku(depo, ANAHTAR_AYAR, {}); }
  function ayarYaz(depo, a) {
    yaz(depo, ANAHTAR_AYAR, {
      url: String(a.url || '').trim(),
      anahtar: String(a.anahtar || '').trim(),
      cihaz: String(a.cihaz || '').trim()
    });
  }
  function listeler(depo) { return oku(depo, ANAHTAR_LISTE, null); }

  // ── Ağ ────────────────────────────────────────────────────────────────────
  // Gövde düz metin olarak gönderilir (Content-Type başlığı eklenmez): böylece
  // tarayıcı ön kontrol (CORS preflight) yapmaz; Google betiği bunu destekler.
  let gonderiliyor = false;

  async function gonder(depo, fetchFn) {
    if (gonderiliyor) return { durum: 'zaten' };
    const a = ayar(depo);
    if (!a.url || !a.anahtar) return { durum: 'ayar_yok' };
    const bekleyen = kuyruk(depo).filter(function (k) { return !k.hata; });
    if (!bekleyen.length) return { durum: 'bos' };
    gonderiliyor = true;
    try {
      let yanit;
      try {
        const r = await fetchFn(a.url, {
          method: 'POST',
          body: JSON.stringify({
            anahtar: a.anahtar,
            kayitlar: bekleyen.map(function (k) {
              return { id: k.id, tarih: k.tarih, tur: k.tur, tutar: k.tutar, hesap: k.hesap,
                       hedef_hesap: k.hedef_hesap, kategori: k.kategori,
                       aciklama: k.aciklama, cihaz: k.cihaz };
            })
          })
        });
        yanit = await r.json();
      } catch (e) {
        return { durum: 'baglanti_yok', hata: String(e && e.message || e) };
      }
      if (!yanit || !yanit.ok) return { durum: 'sunucu_hata', hata: (yanit && yanit.hata) || 'Bilinmeyen yanıt' };

      // Kuyruğu GÜNCEL hâlinden oku: gönderim sürerken eklenen kayıtlar kaybolmasın.
      const alinan = new Set(yanit.alinan || []);
      const red = {};
      (yanit.reddedilen || []).forEach(function (x) { red[x.id] = x.hata; });
      const simdikiKuyruk = kuyruk(depo);
      const kalan = [], gonderilen = [];
      simdikiKuyruk.forEach(function (k) {
        if (alinan.has(k.id)) { gonderilen.push(k); return; }
        if (red[k.id]) { const y = Object.assign({}, k); y.hata = red[k.id]; kalan.push(y); return; }
        kalan.push(k);
      });
      yaz(depo, ANAHTAR_KUYRUK, kalan);
      const zaman = new Date().toISOString();
      const g = gonderilen.map(function (k) { return Object.assign({}, k, { gonderim: zaman }); })
        .concat(gecmis(depo)).slice(0, GECMIS_SINIR);
      yaz(depo, ANAHTAR_GECMIS, g);
      return { durum: 'tamam', gonderilen: gonderilen.length, reddedilen: Object.keys(red).length };
    } finally {
      gonderiliyor = false;
    }
  }

  async function getir(a, islem, fetchFn) {
    const ek = 'anahtar=' + encodeURIComponent(a.anahtar) + (islem ? '&islem=' + islem : '');
    const r = await fetchFn(a.url + (a.url.indexOf('?') >= 0 ? '&' : '?') + ek);
    return r.json();
  }

  async function baglantiTesti(a, fetchFn) {
    if (!a.url || !a.anahtar) return { ok: false, hata: 'Adres ve anahtar gerekli' };
    try {
      return await getir(a, '', fetchFn);
    } catch (e) {
      return { ok: false, hata: 'Bağlantı kurulamadı (' + String(e && e.message || e) + ')' };
    }
  }

  async function listeleriAl(depo, fetchFn) {
    const a = ayar(depo);
    if (!a.url || !a.anahtar) return { durum: 'ayar_yok' };
    try {
      const y = await getir(a, 'listeler', fetchFn);
      if (!y.ok) return { durum: 'sunucu_hata', hata: y.hata };
      if (y.listeler) yaz(depo, ANAHTAR_LISTE, y.listeler);
      return { durum: 'tamam', var: !!y.listeler };
    } catch (e) {
      return { durum: 'baglanti_yok' };
    }
  }

  kok.BT = {
    tutarCoz: tutarCoz, tutarYaz: tutarYaz, bugunIso: bugunIso, isoDanTr: isoDanTr,
    dogrula: dogrula, kayitOlustur: kayitOlustur,
    kuyruk: kuyruk, gecmis: gecmis, kuyrugaEkle: kuyrugaEkle, kuyruktanSil: kuyruktanSil,
    hatayiTemizle: hatayiTemizle, sonSecim: sonSecim,
    ayar: ayar, ayarYaz: ayarYaz, listeler: listeler,
    gonder: gonder, baglantiTesti: baglantiTesti, listeleriAl: listeleriAl
  };
})(typeof window !== 'undefined' ? window : globalThis);
