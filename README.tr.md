# Shadow Box Designer — Gölge Lambası Tasarımcısı

[English](README.md) | **Türkçe**

> **Yapay zeka ajanları / geliştiriciler:** [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) ile başlayın; [`docs/README.md`](docs/README.md) diğer bütün belgelerin haritasıdır (mimari, tasarım kuralları, bilinen sorunlar, modül API'leri). Teknik belgeler İngilizcedir.

Bir **fotoğrafı duvara asılan bir gölge lambasına** dönüştüren masaüstü uygulaması. Fotoğraftan silueti çıkarır, ışığı ortada olan bir lamba gövdesi tasarlar (kare, dikdörtgen, silindir, altıgen, yıldız, çiçek, kalp…) ve gövde duvarındaki kesimleri hesaplar: lamba yandığında siluet duvarda çizilmiş gibi görünür. Sonuç, baskıya hazır **tek bir model dosyasıdır** (STL, 3MF, OBJ, FBX, PLY veya GLB). SVG adımı gerekmez. Arayüz Türkçedir.

![Karanlık Oda görünümünde yanan lamba: siluet duvarda görünüyor](screenshots/02-dark-room-shadow.png)

**İçindekiler:** [Özellikler](#özellikler) · [Kurulum](#kurulum) · [Hızlı başlangıç](#hızlı-başlangıç-5-dakika) · [Lambanın baskısı](#lambanın-baskısı) · [Ekran görüntüleri](#ekran-görüntüleri) · [Ayrıntılı iş akışı](#ayrıntılı-iş-akışı) · [Sorun giderme](#sorun-giderme) · [Proje yapısı](#proje-yapısı) · [Lisans](#yazar-ve-lisans)

## Özellikler

- **Tek tıkla fotoğraf → siluet:** hızlı (düz arka plan), yapay zekayla arka plan kaldırma ya da saç, göz ve sakalı koruyan ayrıntılı portre.
- **İstediğiniz gövde şekli:** kare, dikdörtgen, yuvarlak köşeli, silindir, çokgen, yıldız, çiçek, kalp; daralma ve ayarlanabilir derinlik.
- **Ne görüyorsanız o basılır:** Karanlık Oda önizlemesi, açılmış duvar şeridi ve uyum puanı, dışa aktarılan geometrinin kendisinden hesaplanır.
- **Gölge uyumu** puanı, gerçek gölgenin silüete ne kadar benzeyeceğini söyler; **Detay için iyileştir** boyutu, detay seviyesini ve baskı şeklini sizin için ayarlar.
- **Baskıya hazır mesh:** su geçirmez, havada parça yok, tablanıza sığar (sığmazsa uyarır); tek parça dik baskı ya da yapıştırılan düz paneller.
- **Dahili siluet editörü** (fırça, şekil, metin, katman, simetri, geri al) ve logo/çizimler için **görsel dönüştürücü**.
- **Dışa aktarma:** STL, 3MF, OBJ, FBX, PLY, GLB; dönüştürücüden SVG/PNG.

## Kurulum

**[Node.js](https://nodejs.org/) 20 LTS veya üstü** ve **Git** gerekir (ya da ZIP olarak indirin). Linux, Windows ve macOS'ta çalışır.

```bash
git clone https://github.com/kerim47/ShadowLightBox.git
cd ShadowLightBox
npm install
npm start
```

Git yok mu? GitHub'da **Code → Download ZIP**'e tıklayın, ZIP'i açın, o klasörde bir terminal açıp `npm install` ve ardından `npm start` çalıştırın.

Kurulum dosyası mı istiyorsunuz? `npm run build:win`, `npm run build:mac` veya `npm run build:linux` bir kurulum dosyasını `dist/` klasörüne yazar.

`npm start` hata verirse [Sorun giderme](#sorun-giderme) bölümüne bakın.

## Hızlı başlangıç (5 dakika)

1. **Örneği açın.** İlk açılışta örnek tasarım, tasarımlar klasörünüze kopyalanır: **Dosya → Aç…** → `zoro`. (Ya da [`electron/samples/zoro.json`](electron/samples/zoro.json) dosyasını pencereye sürükleyin.)
2. **İnceleyin.** **Yazıcı Tablası** (`Alt+1`) ile **Karanlık Oda** (`Alt+2`) arasında geçin. Karanlık Oda'da araç çubuğundaki **Ön** düğmesi duvarı tam karşıdan gösterir.
3. **Kendi fotoğrafınızı kullanın.** Sağdaki Inspector'da **Fotoğraf yükle…** (ya da fotoğrafı pencereye sürükleyin), bir yöntem seçin, silueti yerleştirin, **Yerleştirmeyi uygula**'ya tıklayın.
4. **Puana bakın.** Yeşil bir **Gölge uyumu** (≥ %90) hedefleyin. Düşükse **Detay için iyileştir**'e tıklayın.
5. **İndirin.** İndir düğmesinin yanındaki biçimi seçip **İndir**'e tıklayın (`Ctrl+E`). Dosyalar **İndirilenler** klasörüne kaydedilir.

## Lambanın baskısı

| Ayar | Varsayılan | Ne yapmalı |
|---|---|---|
| Baskı şekli | Tek parça (dik) | Gövdeyi dik basın ve **dilimleyicide desteği açın** (Cura / PrusaSlicer / Bambu Studio; *tree* destekler en kolay sökülür). |
| Desteksiz baskı | **Kapalı** | Yalnızca küçük, toplu silüetlerde açın. Sarkan yerlerin altına küçük çatılar ekler; lambadan uzakta duvarda testere dişi gibi görünür. |
| Düz paneller | – | Çokgen gövdeler için: her kenar desteksiz, yatık basılır, sonra yapıştırılır. Çok ince detayda iyi sonuç verir. |
| Duvar kalınlığı | 1,6 mm | Kalın olan daha sağlamdır; en az 0,8 mm. |
| Tabla X / Y / Z | 256 mm | Yazıcınızın baskı alanını girin; gövde sığmazsa tabla görünümü uyarır. |

- **Malzeme:** ışık geçirmeyen, koyu renkli PLA veya PETG en iyi sonucu verir (beyaz ya da yarı saydam filament ışığı duvardan geçirir).
- **Işık:** küçük, tek çipli bir LED (1–3 W, sıcak beyaz, ≥ 120°); bkz. [Hangi ışık?](#hangi-ışık). Ampuller bulanık gölge verir.
- **Işık parçaları** (ön kapak / LED yuvası, tüp tutucu) önizlemelerde gizlidir ve varsayılan olarak indirmeye dahil edilmez. Tablada **Montaj parçaları** ile gösterebilir, basmak isterseniz indirme penceresinde dahil edebilirsiniz.
- **Montaj:** taban plakası duvara gelir; anahtar deliğinden bir vidaya asılır. Resim lambanın çevresinde duvarda belirir; **Gölge boyutu** resmin yarı genişliğidir.

## Ekran görüntüleri

Hepsi paketteki `zoro.json` örneği ve varsayılan ayarlarla alındı.

| | |
|---|---|
| ![Karanlık Oda, önden](screenshots/02-dark-room-shadow.png) | ![İçinde LED olan açık lamba gövdesi](screenshots/05-open-lamp.png) |
| **Karanlık Oda:** duvardaki gölge, %99 uyum | **Önü açık:** yalnızca basılan gövde ve ışık |
| ![Yazıcı tablası](screenshots/03-print-bed.png) | ![Siluet editörü](screenshots/04-silhouette-editor.png) |
| **Yazıcı Tablası:** ölçüleriyle tabladaki gövde | **Siluet Editörü:** silueti rötuşlayın |

## Ayrıntılı iş akışı

1. **Fotoğraf → siluet.** Bir fotoğraf seçip yöntemi belirleyin:
   - *Ayrıntılı portre* (varsayılan) yüz detaylarını korur. Arka plan ayrılır (varsa yapay zekayla). Kişinin içinde koyu alanlar (saç, kaş, göz, sakal, koyu giysi) gölge, açık alanlar ışık olur; şablon gibi. İsteğe bağlı dış çizgi, açık renkli bir yüzü açık arka plandan ayırır.
   - *Hızlı* arka plan rengini fotoğrafın kenarından bulur. Düz arka planlarda iyi çalışır, model gerektirmez.
   - *Yapay zekayla arka plan kaldırma* her fotoğrafta çalışır. IS-Net genel amaçlı modelini (Apache-2.0) kullanır; model bir kez (~170 MB) uygulama veri klasörüne indirilir. İndirme başarısız olursa küçük U²-Net-p modeline geçilir.
   - Hassasiyet, yumuşatma, ters çevirme ve "dolu siluet" seçenekleriyle zor durumları düzeltebilirsiniz.
2. **Yerleştirin.** Silueti sürükleyip tekerlekle konumlandırın. Turuncu artı ışıktır, kırmızı çerçeve lamba gövdesidir. Detay lambanın yakınında en incedir ve uzaklaştıkça kabalaşır (büyütme t = ρ/r); bu yüzden lambayı en ayrıntılı bölgeye yakın koyun. Portrelerde bu genelde yüzün ortasıdır. Sonra **Yerleştirmeyi uygula**'ya tıklayın. Rötuş için **Siluet Editörü**'nü kullanın (küçük resme tıklayın).
3. **Gövde şekli.** Uygulama silüetin oranlarına göre bir şekil önerir (uzun → dikey dikdörtgen, toplu ve yuvarlak → silindir, …). İstediğiniz zaman değiştirebilirsiniz.
4. **Lambayı indirin.** İndir düğmesinin yanındaki biçimi (STL, 3MF, OBJ, FBX, PLY veya GLB) seçip **İndir**'e tıklayın (`Ctrl+E`).

![Fotoğraftan ayrıntılı portre](screenshots/01-photo-portrait.png)

### Çıkarmaya yardım etmek (fotoğraf penceresi)

- **▭ Detay alanı (A):** algoritmanın kaçırdığı bir şeyin (karakterin arkasındaki kılıç…) çevresine kutu çizin. Fotoğrafın tamamı yine her zamanki gibi işlenir; her kutunun içinde koyu çizgiler yerel kontrastla yeniden aranır ve sonuca **eklenir**; böylece nesne siyah bir kutuya dönüşmeden kendi kenarlarını korur. Birden çok kutu çizilebilir; `Ctrl+Z` sonuncuyu siler.
- **🖌 Ekle (E) / ⌫ Çıkar (R):** kaçırılan bir parçanın (kılıç, saç teli) ya da istenmeyen bir şeyin üzerini kabaca boyayın. Portre yönteminde boyanan alan kişiye katılır ve koyu çizgileriyle dış hattı gölge olur; düz yöntemlerde tamamen gölge veya ışık olur.
- Kutular ve fırça darbeleri yapay zeka modelini yeniden çalıştırmaz.

## İnce ayrıntılar

- **Varsayılana dön (↺):** değiştirilen her ayarın adının yanında ↺ çıkar (üzerine gelince varsayılan değer görünür); her bölüm başlığında bütün grup için bir ↺, Inspector başlığında **↺ Tümü** vardır. Hepsi `Ctrl+Z` ile geri alınabilir.
- **Dosya seçici:** masaüstü uygulamasında her "dosya aç" işlemi uygulama içi bir seçici kullanır (yerler, klasörler, filtre, resim önizleme, klavye). Sistemin GTK penceresi Linux'ta Electron'u çökertiyordu (`GLib-GObject … no handler with id` → SIGTRAP), bu yüzden hiç açılmaz.
- **Tek görünüm.** Bütün ayarlar Inspector'da her zaman görünür (basit/gelişmiş modu yok); bölümler katlanabilir ve aranabilir (`Ctrl+P`).
- **Yazıcı tablası:** Baskı Ayarları **Tabla genişliği (X)**, **Tabla derinliği (Y)** ve **Baskı yüksekliği (Z)** ile başlar. Tabla görünümü bu dikdörtgeni çizer ve gövde sığmazsa (iki yönde de) uyarır. Tek tabla ölçüsü olan eski tasarımlar kare tablayla açılır.
- Işık parçaları (ön kapak, LED yuvası, tüp tutucu) varsayılan olarak gizlidir: tabla yalnızca lamba gövdesini gösterir (araç çubuğundaki **Montaj parçaları** onları gösterir), Karanlık Oda ise önü açık şekilde yalnızca basılan gövdeyi ve ışığın kendisini gösterir. Siz dahil etmedikçe indirmeye girmezler.
- **Detay hattı.** Siluetler 2048 px'te işlenir. Harfler, dal uçları ve parmak araları gibi küçük parçalar korunur, kenarlar yumuşatılmış kalır; böylece duvar ızgarası piksel altı kenarları çözebilir. Detay seviyeleri "Çok yüksek"e (≈650 bin hücre) kadar çıkar.
- **Gölge uyumu.** Lambanın gerçekten düşüreceği gölgenin siluete ne kadar uyduğunu (IoU), ayrıca kaybolan detayı, fazladan gölgeyi ve lambanın yakınında ve gölge kenarında basılabilecek en ince detayı gösterir.
  - Neden bir sınır var: duvardaki bir ayrıntı lamba duvarında t = ρ/r oranında küçülür ve yazıcı ~0,8 mm'den çok daha ince çizgileri basamaz.
- **Detay için iyileştir.**
  - Gövdeyi tabla sınırı içinde büyütür ve "Çok yüksek" seviyesini dener.
  - Baskı şekillerini de karşılaştırır: dik desteksiz, dik ve dilimleyici desteğiyle, düz paneller + 0,2 mm katman.
  - En iyi uyumu veren birleşimi seçer ve nedenini açıklar. Çok ayrıntılı çizimlerde genelde düz paneller kazanır, çünkü ne çatı ne köprü gerektirir.

## Görsel Dönüştürücü

Ana fotoğraf → lamba akışının dışında tutulan, isteğe bağlı ek bir araç: **Araçlar → Görsel Dönüştürücü** (`Ctrl+Shift+G`) ile açılır. Bir fotoğrafı, logoyu, çizimi veya SVG'yi **baskıya hazır** bir şablona ve SVG'ye dönüştürür:

- **Yöntemler:** parlaklık eşiği (Otsu veya yerel), renk katmanları (k-means; bir renk örneğine tıklayınca gölge olur), çizgi (kenarlar), nesne silueti (hızlı veya yapay zeka) ve ayrıntılı portre.
- **Yerleştirme** doğrudan mevcut lambanın gölge çerçevesinde yapılır; kırmızı kesikli çizgi gövdedir.
- **3D baskı kontrolü:** şablon açılmış lamba duvarına eşlenir ve orada gerçek milimetreyle ölçülür. Tabana bağlı olmayan gölge parçalarına (baskıda havada kalırlar) köprü eklenir, en küçük değerden (varsayılan 2 × nozül) ince çizgiler kalınlaştırılır, dar ışık aralıkları kapatılır veya genişletilir. **Baskı analizi** görünümü neyin değiştiğini, **Basılacak gölge** lambanın gerçek duvar alanından hesaplanan gölgeyi gösterir.
- **Çıktı:** gerçek duvar boyutunda (cm) SVG (tek "Ayrıntı" seçimi: yüksek / dengeli / hafif), PNG ya da **Lambaya uygula** (`Ctrl+Enter`).
- Dışa aktarılanlar (lamba modelleri, SVG, PNG, JSON) doğrudan **İndirilenler** klasörüne yazılır; bildirimde "Klasörde göster" düğmesi vardır.

## Menüler, kısayollar, sürükle-bırak

- Menü çubuğu: **Dosya · Düzen · Görünüm · Araçlar · Yardım**. `F1` bütün kısayolları listeler.
- Sık kullanılan kısayollar: `Ctrl+N/O/S/Shift+S` yeni/aç/kaydet/farklı kaydet, `Ctrl+Z/Y` geri al/yinele (lamba ayarları ve siluet ya da dönüştürücü ayarları), `Ctrl+E` lambayı seçili biçimde indir, `Ctrl+1/2` Lamba / Siluet Editörü, `Ctrl+Shift+G` görsel dönüştürücü, `Alt+1/2` tabla/karanlık oda.
- **Yerleşim (Unity gibi):** her çalışma alanında sahne/görünüm solda, bütün ayarları içeren **Inspector** sağdadır. Başlığında **Özellikler | Dosyalar** sekmeleri ve bir arama kutusu vardır: `Ctrl+P` ayarları yerinde süzer (Türkçeye toleranslı: "kalınlık" "kalınlığı"nı bulur; `Enter` ilk eşleşmeye atlar). **Dosyalar** (`Ctrl+J`) kayıtlı tasarımları (aç, sil, yeni, klasör) ve bu oturumda dışa aktarılanları listeler.
- Ayar açıklamaları yuvarlak **?** simgelerinin arkasındadır: üzerine gelince kısa ipucu, tıklayınca sağda tam metin ve o bölümün diğer açıklamalarıyla **Açıklamalar** paneli açılır.
- Fotoğraf penceresi: `A` kutu, `E` ekle fırçası, `R` çıkar fırçası, `X` değiştir, `[ ]` fırça boyutu, `Ctrl+Z` darbeyi geri al, `Delete` temizle. Dönüştürücü: `[ ]` boyut, `Q W` döndür, oklar taşır, `H` aynala, `1–4` görünümler, `P` yollar, `+ − 0` yakınlaştırma.
- Durum çubuğu: **Baskı** özeti (baskı kontrolü) ve her durum mesajının geçmişi olan **Mesajlar**. Tabladaki yeşil baskı çubuğu yalnızca birkaç saniye görünür.
- Kaydedilmemiş değişiklik varken pencereyi kapatmak **Kaydet ve çık / Kaydetmeden çık / İptal** diye sorar.
- Dosyaları her yere bırakabilirsiniz: resimler fotoğraf → siluet penceresini (dönüştürücü açıksa onu) açar, `.json` tasarımlar açılır, STL/OBJ/3MF/FBX karşılaştırma modeli olarak yüklenir. `Ctrl+V` bir resmi aynı şekilde yapıştırır.

## Siluet Editörü

**Siluet Editörü** çalışma alanı (üst çubuk), lamba ekranını kalabalıklaştırmayan ayrı, tam ekran bir boyama alanıdır:

- **Araçlar:** gölge fırçası, ışık fırçası, silgi, boya kovası, çizgi, dikdörtgen, elips, metin, taşı, el.
- **Fırça seçenekleri:** boyut (`[` ve `]`), gölge/ışık rengi (`X`), dolu şekiller, yatay ve dikey simetri, darbe yumuşatma.
- **Geçmiş ve görünüm:** geri al/yinele (Ctrl+Z, Ctrl+Y), yakınlaştırma (tekerlek, `+`, `−`, sığdır, 1:1), kaydırma (Boşluk+sürükle veya orta tuş).
- **Katmanlar:**
  - Silüetin üstüne resim ekleyin; taşıyın, ölçekleyin, döndürün, çevirin veya saydamlaştırın.
  - Bir resmi siyah-beyaza (eşik) ya da hızlı veya yapay zeka yöntemiyle silüete dönüştürün.
  - Katmanları yeniden sıralayın, çoğaltın, silin veya birleştirin.
- **Bütün resim işlemleri:** ters çevir, aynala, 90° döndür, kalınlaştır, incelt, kenar yumuşat, kırıntı temizle.
- **Kaplamalar:** ızgara ve ışık merkeziyle lamba izdüşümü.
- **Lambaya uygula** sonucu lambaya geri yazar.

![Araçlar, izdüşüm kaplaması ve düzenleme işlemleriyle siluet editörü](screenshots/04-silhouette-editor.png)

## Doğruluk kontrolü (Model Karşılaştırma)

- Bir STL, OBJ, 3MF veya FBX dosyası yükleyin. Birim, yukarı ekseni, hizalama, döndürme, kaydırma, renk ve saydamlık ayarlarıyla iki 3B görünümde de üretilen lambanın üzerine bindirilir.
- Bu uygulamadan indirilen bir STL, "Orijinal koordinatlar" ile yüklendiğinde önizlemeyle boyut ve konumda 0,0 mm farkla örtüşür.
- Karşılaştırma yalnızca lamba bölgesindeki model noktalarını ölçer; gövdenin yanına basılan kapak sayıları bozmaz.
- **Karanlık oda ışığı ve duvarı:** oda araç çubuğunda LED rengi ve ışık şiddeti kaydırıcısı vardır (ayrıca **Karanlık Oda** altında: LED rengi, Işık şiddeti %10–300, Duvar rengi). **Aydınlanan duvar genişliği** (varsayılan 240 cm) duvarın ne kadarının benzetileceğini belirler; gölge alanı dışındaki ışık da gösterilir. Yalnızca önizlemedir; baskı değişmez.
- **Gerçek gölge** (karanlık oda araç çubuğu) duvardaki gölgeyi benzetim yerine gerçek 3B geometriden, noktasal ışık gölge haritasıyla çizer. Karşılaştırmak için açıp kapatın. Yüklenen model de gölge düşürür.

## Gövde ve baskı seçenekleri

**Işık montajı** (Baskı Ayarları → Işık montajı):
- **Şeffaf tüp (varsayılan).** Taban plakasında hazır bir akrilik tüp için tutucu halka vardır. Kapak tüpün tepesine *içten* takılır, LED altındaki kısa bir direkte duvara bakacak şekilde asılı durur. LED kapağın en alt noktasıdır; böylece uzak duvara ulaşan yataya yakın ışınları hiçbir opak parça kesmez. Duvar yalnızca silüetin olduğu yerde yükselir; ön çember, kapak ve destek kolonları gerekmez ve gölgede kolon çizgisi olmaz. Silüet lambanın etrafını sarmalıdır ki her duvar parçası tabana ulaşsın. Uygulama kesilecek tüp boyunu bildirir.
- **Ön kapak.** Özgün tasarım: ışığın önündeki dolu bir çember, LED yuvalı bir kapağı taşır; destek kolonları çemberi tabana bağlar.

- **Tek parça modu** (varsayılan). Duvar ve taban plakası tek bir gövdedir, dik basılır. Taban plakasında bir vidaya asmak için anahtar deliği vardır. Ön **kapak** aynı STL'de ayrı bir nesnedir ve yatık basılır; LED'i "Işık konumu"nda duvara bakacak şekilde tutar, ortasında kablo deliği vardır.
- **Düz panel modu** (yalnızca çokgen şekiller). Her kenar için bir düz panel, ayrıca plaka ve kapak tablaya dizilir. Paneller desteksiz basılır; sonra birbirine yapıştırılır. Panel uçları varsayılan olarak 45° pahlıdır, köşeler temiz kapanır. Her panelin altındaki isteğe bağlı 0,2 mm destek katmanı, kopuk parçaları köprüsüz tutar.
- Duvar, marching squares ile kesim kenarları düzgün, **su geçirmez** bir katıya dönüştürülür (≈0,5–1 mm ızgara; görüntünün en çok büyüdüğü yerde daha ince).
- **Destekli baskı** (tek parça modu, varsayılan): gölge silüete birebir uyar. Gövde dik basıldığı için **dilimleyicide desteği açın** (Cura, PrusaSlicer, Bambu Studio: "tree" destekler iyi çalışır); baskıdan sonra sökün.
- **Desteksiz dik baskı** (*Desteksiz baskı* seçeneği, varsayılan kapalı):
  - 60°'den dik sarkmalar ve 12 mm'den uzun desteksiz açıklıklar altına küçük bir çatı alır; gövde desteksiz basılır.
  - Çatılar duvarda büyür: lambadan uzaktaki geniş aydınlık bir alanın kenarı testere dişi gibi olur (örnek tasarımda gölge uyumu %99'dan %81'e düşer). Yalnızca toplu silüetlerde kullanın.
  - Kısa köprüler olduğu gibi bırakılır.
- **Basılabilirlik düzeltmeleri:**
  - **Destek kolonları** ön çemberi tabana bağlı tutar. Her kolon çemberden en yakın dolu parçaya kadar uzanır ve silüetin zaten gölge düşürdüğü yere konur.
  - **Kopuk parçalar** (ör. ince bir boynun üstündeki kafa) atılmak yerine ince bir köprüyle bağlanır.
  - İğne delikleri doldurulur.
  - Çember havada kalacaksa veya parçalar tablayı aşıyorsa uygulama uyarır.

![Gölge izdüşümü ve ölçülerle yazıcı tablası görünümü](screenshots/03-print-bed.png)

## Hangi ışık?

**Küçük, tek çipli bir LED** kullanın: 1–3 W, yayıcı ≤ 3 mm, sıcak beyaz, ≥ 120° ışın açısı. Örneğin 20 mm star PCB üzerinde 1 W veya 3 W bir LED ve 5 V USB sürücü. "LED yuva çapı"nı PCB'nize göre ayarlayın.

Gölge kenarları yayıcı boyutuyla orantılı bulanıklaşır; ampuller (E14/E27) ve büyük COB diskler yumuşak, dağınık siluetler verir.

## Tasarımları kaydetme ve açma

- **Kaydet** mevcut dosyaya yazar (mevcut dosya yoksa "Farklı kaydet" olur).
- **Farklı kaydet…** bir ad sorar ve `%APPDATA%\shadowbox-designer\designs\<ad>.json` dosyasına yazar.
- **Aç…** kayıtlı bütün tasarımları, her satırda bir sil düğmesiyle listeler.
- **Klasörü göster** veri klasörünü dosya yöneticisinde açar.

Başarılı kayıtları 5 saniyelik yeşil bir "Kaydedildi" bildirimi onaylar.

## Çıktı

- **Lamba modeli** (biçim menüsü + `İndir` ya da **Dosya → Farklı biçimde indir**). Parçalar: `shell` veya `panel-N`, `base-plate`, `cap`, `cap-lip`, `led-tube`, `led-cup` (tüp montajında: `tube-holder`, `tube-cap…`). Duvar kalınlığı varsayılan 1,6 mm. Seçilen biçim hatırlanır. Her indirme **ışık parçalarının** (LED kapağı / ışık çubuğu, tüp tutucu) dahil edilip edilmeyeceğini sorar; **varsayılan olarak dışarıda bırakılırlar**; Unity, Blender vb. programlara aktarırken istenen de budur.
  - **STL**: ikili, mm, Z yukarı — her dilimleyici açar.
  - **3MF**: mm, Z yukarı; her parça ayrı nesne, tek bir montaj nesnesinin bileşenleri olarak gruplanır (Bambu Studio, PrusaSlicer, Cura).
  - **OBJ**: metin, mm, Z yukarı, her parça için bir `o`.
  - **FBX**: ikili FBX 7.4; GlobalSettings'te mm (`UnitScaleFactor` 0.1) ve Z yukarı; köşe başına normaller (30° yumuşatma), tek malzeme, zlib ile sıkıştırılmış diziler (Blender, Unity, 3ds Max).
  - **PLY**: ikili little-endian, mm, Z yukarı, tek gövde.
  - **GLB**: glTF 2.0 ikili; glTF standardının istediği gibi metre ve Y yukarı.
  - STL dışında çakışan köşeler birleştirilir; böylece her parça indekslere göre de su geçirmezdir (3MF doğrulayıcıları ve dilimleyiciler bunu ister).

Eski, yalnızca kutu yapan sürümle kaydedilen tasarımlar (v1 biçimi, ör. `zoro.json`) dikdörtgen gövdeyle açılır.

## Geliştirme

[Node.js](https://nodejs.org/) (LTS, ör. 20.x) gerekir.

```bash
npm install
npm start                  # masaüstü uygulamasını başlatır (Electron'u --no-sandbox ile çalıştırır)
npm run build:win          # dist/ içine Windows kurulum dosyası üretir
npm test                   # geometri çekirdeği testleri (izdüşüm, su geçirmez mesh, basılabilirlik kuralları)
```

Windows kurulumu veri klasörü olarak `%APPDATA%\Shadow Box Designer\designs\` kullanır. Paketteki örnek (`zoro.json`) ilk açılışta bu klasöre kopyalanır; **Aç…** penceresinden hemen açabilirsiniz.

Arayüzü herhangi bir tarayıcıda statik sayfa olarak da sunabilirsiniz (yapay zekayla arka plan kaldırma yalnızca masaüstünde çalışır):

```bash
python3 -m http.server 8000
# http://localhost:8000 adresini açın
```

Tarayıcı modunda Kaydet / Farklı kaydet / Aç, dosya sistemi yerine `localStorage` kullanır. Yalnızca masaüstüne özgü kontroller (yapay zeka yöntemi, "Klasörü göster") orada gizlidir.

## Sorun giderme

| Sorun | Çözüm |
|---|---|
| `npm start` Electron'un kurulamadığını söylüyor | npm 11+ kurulum betiklerini atlar. Bir kez `node node_modules/electron/install.js` çalıştırın. |
| Linux: *"The SUID sandbox helper binary was found, but is not configured correctly"* | `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox` ya da `npx electron . --no-sandbox` ile başlatın. |
| Gölgenin kenarında testere dişleri veya kara kamalar var | **Baskı Ayarları → Desteksiz baskı** açık. Kapatın ve dilimleyici desteğiyle basın ya da düz panelleri kullanın. |
| **Gölge uyumu** düşük / ince çizgiler kayboluyor | Detay gölge kenarına doğru küçülür. Gövdeyi büyütün, **Gölge boyutu**nu küçültün, **Detay seviyesi → Çok yüksek** seçin ya da **Detay için iyileştir**'e tıklayın. |
| Gövde tablaya sığmıyor | **Tabla genişliği / derinliği / Baskı yüksekliği**'ni yazıcınıza göre girin, gövdeyi küçültün ya da düz panellere geçin. |
| Yapay zekayla arka plan kaldırma çalışmıyor | Model (~170 MB) ilk kullanımda indirilir; internet bağlantınızı kontrol edin. Uygulama daha küçük bir modele geçer; *Hızlı* yöntem hiç model gerektirmez. |

## Proje yapısı

Standart Electron ayrımı: Node tarafı için `electron/`, tarayıcı tarafındaki uygulama için `renderer/`.

```
ShadowLightBox/
├── package.json            npm betikleri + electron-builder ayarları
├── electron/
│   ├── main.cjs            BrowserWindow + IPC (tasarımlar, yapay zekayla arka plan kaldırma)
│   ├── preload.cjs         contextBridge → window.appAPI
│   └── samples/            ilk açılışta kullanıcı veri klasörüne kopyalanan JSON dosyaları
├── renderer/
│   ├── index.html
│   └── src/
│       ├── shapes.js       Gövde kesitleri (yıldız biçimli çokgenler), şekil önerisi
│       ├── projection.js   İleri/ters izdüşüm matematiği (kutu + her şekil, daralma)
│       ├── wall_field.js   Açılmış duvar örneklemesi, destek kolonları, köprüler, temizlik
│       ├── shell_mesher.js Marching squares → su geçirmez mesh, plaka, kapak, ikili STL
│       ├── exporters.js    Lamba meshleri → 3MF / OBJ / FBX / PLY / GLB (ve STL)
│       ├── silhouette.js   Fotoğraf → siluet (hızlı mod + yapay zeka maskesi son işleme)
│       ├── stencil.js      Dönüştürücü çekirdeği: resim → şablon, açılmış duvarda baskı kontrolü, SVG
│       ├── converter.js    Görsel Dönüştürücü arayüzü
│       ├── menubar.js      Menü çubuğu + klavye kısayolları
│       ├── model_import.js Doğruluk karşılaştırması için STL/OBJ/3MF/FBX yükleyici
│       ├── editor.js       Siluet Editörü: boyama alanı (araçlar, katmanlar, geri al/yinele)
│       ├── designer.js     Siluet tuvali, yerleştirme, fırça, duvar şeridi, gölge benzetimi
│       ├── geometry.js     Three.js oda sahnesi (duvar gölgesi, lamba gövdesi, LED parıltısı)
│       ├── storage.js      Depolama (Electron IPC veya localStorage)
│       ├── filepicker.js   Uygulama içi dosya seçici (sistem penceresi yok)
│       ├── inspector.js    Sağdaki Inspector (ayar arama, dosyalar sekmesi)
│       ├── helptips.js     "?" yardım simgeleri ve Açıklamalar paneli
│       ├── main.js         Arayüz bağlantıları, fotoğraf penceresi, model indirme, kaydet/aç
│       └── styles.css
├── tests/run-tests.js      Node test paketi (npm test)
├── docs/                   Mimari, tasarım kuralları, bilinen sorunlar, modül API'leri (İngilizce)
├── */CLAUDE.md             Yapay zeka ajanları için klasör rehberleri
├── AGENTS.md / CLAUDE.md   Yapay zeka kodlama ajanları için rehber
├── README.md               İngilizce belge (varsayılan)
└── README.tr.md            Bu dosya
```

## Baskı notları

- **Birimler:** arayüz ve hesaplar cm, STL mm kullanır.
- **Önce deneme baskısı yapın.** İzdüşüm hesabı ışık kaynağının gerçek konumuna duyarlıdır. LED'in 2 mm kayması dış ayrıntıları gözle görülür biçimde kaydırır.

## Yazar ve lisans

Geliştiren: **Abdülkerim Akan** (kerimakan77@gmail.com).

MIT lisansıyla yayımlanmıştır; bkz. [`LICENSE`](LICENSE).
