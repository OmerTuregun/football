import type { DailyGameId } from './daily-access';

export interface GameHelpContent {
  title: string;
  summary: string;
  steps: string[];
  tip?: string;
}

export const GAME_HELP: Record<DailyGameId, GameHelpContent> = {
  'daily-player': {
    title: 'Günlük Oyuncu',
    summary: 'Günün gizli futbolcusunu ipucu kartlarıyla bulmaya çalışırsın.',
    steps: [
      'Oyuncu adını yazıp tahmin gönder.',
      'Her tahminden sonra 6 kart güncellenir: milliyet, lig, kulüp, mevki, yaş, forma numarası.',
      'Yeşil = doğru, sarı = yakın / kısmen doğru, kırmızı = yanlış.',
      'Yaş ve forma numarasında ↑/↓ okları hedefin daha yüksek veya düşük olduğunu gösterir.',
      `En fazla 8 denemen vardır. Bugünkü resmi tur bir kez sayılır.`,
    ],
    tip: 'Lig kartı yalnızca yerel ligi gösterir (Şampiyonlar Ligi vb. değil).',
  },
  'higher-lower': {
    title: 'Higher or Lower',
    summary: 'İki oyuncu arasında, verilen istatistikte hangisinin daha yüksek olduğunu tahmin et.',
    steps: [
      'Soldaki referans oyuncu ile sağdaki rakibi karşılaştır.',
      'Kategori yaş, gol, asist, kulüp sayısı veya piyasa değeri olabilir.',
      '“Daha fazla” veya “Daha az” seç; doğruysa serin uzar.',
      'Yanlışta seri biter. En iyi serin kaydedilir.',
    ],
    tip: 'Mod ve zorluk, hangi oyuncu havuzundan geldiğini değiştirir.',
  },
  'missing-xi': {
    title: 'Kayıp 11',
    summary: 'Bir maçın ilk 11’indeki eksik oyuncuları tamamla.',
    steps: [
      'Sahadaki boş formaları seç veya sırayla tahmin et.',
      'Tahminler Wordle benzeri harf geri bildirimiyle ilerler.',
      'Doğru oyuncu yerine oturur; tüm 11’i doldurunca kazanırsın.',
      'Vazgeçersen cevaplar açılır.',
    ],
    tip: 'Mod (Genel / ŞL / 5 büyük lig) hangi maç havuzunu kullanacağını seçer.',
  },
  'career-path': {
    title: 'Kariyer Rotası',
    summary: 'Oyuncunun kulüp yolunu görüp kim olduğunu bul.',
    steps: [
      'Ekranda sırayla oynadığı kulüplerin armaları / isimleri görünür.',
      'Bu kariyere uyan oyuncuyu ara ve tahmin et.',
      'En fazla 8 denemen vardır.',
      'Vazgeçersen doğru isim açıklanır.',
    ],
    tip: 'Kısa veya alışılmadık kariyerler zorluk seviyesine göre daha sık çıkar.',
  },
  'club-grid': {
    title: 'Kulüp Grid',
    summary: 'Satır ve sütun kulüplerinin kesişiminde doğru oyuncuyu yerleştir.',
    steps: [
      'Her hücre hem satır hem sütun kulübünde forma giymiş bir oyuncu ister.',
      'Hücreye tıklayıp oyuncu ara ve seç.',
      'Aynı oyuncuyu grid’de iki kez kullanamazsın.',
      'Tüm hücreler dolunca kazanırsın; vazgeçince cevaplar açılır.',
    ],
    tip: 'Yanlış tahmin hücreyi kilitlemez; boş kalır ve tekrar deneyebilirsin.',
  },
  onluk: {
    title: 'Onluk',
    summary: 'Son 3 sezona göre ilk 10 listesini tamamla.',
    steps: [
      'Soruya uyan oyuncuları tahmin et (ör. bir kulüpte en çok maç).',
      'Doğru isim alttan yukarı kutuları gezer ve kendi sırasına oturur.',
      'Yanlış tahmin can götürür (3 can).',
      'İki peş peşe doğru tahmin → +1 can (en fazla 3).',
      '10 ismi bulunca kazanırsın.',
    ],
    tip: 'Onluk’ta zorluk seçimi yoktur; her zaman orta seviye kullanılır.',
  },
  connections: {
    title: 'Bağlantılar',
    summary: '16 oyuncuyu 4 gizli gruba ayır.',
    steps: [
      'Her grupta 4 oyuncu vardır; ortak nokta kulüp, uyruk, turnuva vb. olabilir.',
      '4 kart seçip “Gönder”e bas.',
      'Doğruysa grup açılır ve tahtadan çıkar.',
      'Yanlışta bir hata hakkı yanar (4 hakkın vardır).',
      'İstersen karıştır; “bir uzakta” uyarısı 3 doğru + 1 yanlış seçimde çıkar.',
    ],
    tip: 'Kulüp armaları kartlarda gösterilmez — bağlantıyı kendin bulmalısın.',
  },
};
