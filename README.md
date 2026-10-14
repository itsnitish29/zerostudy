# GKGS Quiz — Secure Server Version

यह केवल HTML फाइल नहीं, बल्कि Node.js + Express + SQLite पर चलने वाला वेबसाइट प्रोजेक्ट है। Admin/Student permissions सर्वर पर लागू होती हैं; सिर्फ UI में बटन छिपाने पर निर्भर नहीं हैं।

## इस संस्करण में सुरक्षा

- **Server-side roles:** केवल सफल Admin login वाला server session क्विज़ Create/Edit/Delete और सभी छात्र-रिजल्ट देख सकता है।
- **Admin password frontend में नहीं है:** पासवर्ड `.env` में रखा जाता है और login तुलना bcrypt hash के जरिए होती है।
- **Secure sessions:** HttpOnly, SameSite=Strict cookies; production में Secure cookie; login पर session ID rotate होता है।
- **Server-side scoring:** सही उत्तर की जाँच और स्कोर सर्वर करता है। Student API को टेस्ट शुरू करने से पहले सही उत्तर नहीं भेजे जाते।
- **CSRF mitigations:** state-changing requests के लिए same-origin validation और custom request header।
- **Security headers:** Helmet/CSP, no `X-Powered-By`.
- **Rate limiting:** Admin login और quiz attempts पर सीमाएँ।
- **Persistent storage:** क्विज़, प्रयास और रिजल्ट SQLite database में सेव होते हैं, browser localStorage में नहीं।
- **Result access control:** Student केवल अपने वर्तमान browser session से जुड़े attempt का result खोल सकता है; Admin server-side permission से सभी attempts देख सकता है।
- **Input limits/validation:** JSON body limits, quiz/question limits, name/mobile validation, answer validation।
- **Quiz delete protection:** जिस quiz के attempts रिकॉर्ड में हैं, उसे सीधे delete नहीं किया जा सकता।

## Local computer पर चलाएँ

1. इस ZIP को extract करें। Node.js 20 या नया इंस्टॉल होना चाहिए।
2. Terminal/Command Prompt में project folder खोलें।
3. `.env.example` की कॉपी बनाकर उसका नाम `.env` रखें।
4. `.env` में ये दो चीजें बदलें:
   - `SESSION_SECRET`: लंबा random secret (कम-से-कम 32 characters)। Generate करने के लिए: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `ADMIN_PASSWORD`: अपना unique, मजबूत पासवर्ड (कम-से-कम 14 characters)। इसे किसी के साथ साझा न करें।
5. Dependencies इंस्टॉल करें: `npm install`
6. वेबसाइट चलाएँ: `npm start`
7. Browser में `http://localhost:3000` खोलें। पहली बार 3 sample quizzes अपने-आप बनेंगे।

## Online publish करने से पहले जरूरी

- Hosting platform पर `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `PORT` और `DB_PATH` environment variables सेट करें। `.env` या database को public repository में upload न करें।
- **HTTPS अनिवार्य रखें** और host/reverse proxy को सही तरह configure करें; production में Secure session cookies इसी पर निर्भर हैं।
- SQLite के लिए persistent disk/volume लगाएँ और नियमित encrypted backups बनाएँ। Ephemeral hosting disk पर database खो सकता है।
- Admin password को अलग, मजबूत password से बदलें; साझा कंप्यूटर पर logout करें।
- मोबाइल नंबर व्यक्तिगत जानकारी है: केवल जरूरी अवधि तक रखें, Admin access सीमित करें, और अपनी privacy notice/retention policy बनाएं।
- इस starter project में मोबाइल नंबर **OTP से verify नहीं होता**। छात्र जो नाम/नंबर भरता है, वह दर्ज होता है; यह अपने-आप उसकी असली पहचान का प्रमाण नहीं है। OTP verification के लिए SMS provider जोड़ना होगा।
- कोई भी web application पूर्णतः जोखिम-मुक्त नहीं होती। Public launch से पहले hosting configuration, backups, monitoring और security review करवाएँ।

## भूमिका का व्यवहार

### Student
- उपलब्ध quiz देखना, attempt करना और उसी session में अपना result/review देखना।
- Quiz बनाना, edit/delete करना या पूरे score register को देखना नहीं।
- सही answers और scoring logic submit करने से पहले public quiz API में नहीं भेजे जाते।

### Admin / Creator
- Admin password से login।
- Quiz create/edit/delete (जिस quiz के attempts हों, उसका delete block होता है)।
- सभी attempts/score register देखना और CSV export करना।
- Logout के बाद server session समाप्त।

## Database

Default database: `./data/gkgs.sqlite`; session store: `./data/sessions.sqlite`। इन्हें public web root में न रखें और backup को सुरक्षित रखें।

## इंटरनेट पर Live करने का तरीका (Render)

यह project internet-ready deployment configuration (`render.yaml`) के साथ आता है। इसे live करने के लिए आपके अपने hosting/GitHub accounts की जरूरत होगी; इस चैट से आपके खाते में login करके publish नहीं किया जा सकता।

1. GitHub पर अपने खाते में एक **private repository** बनाएँ और इस project की सभी files upload करें। `.env`, `data/`, database files या passwords upload न करें।
2. Render.com पर अपने ही खाते से sign up/login करें और GitHub connect करें।
3. Render Dashboard में **New → Blueprint** चुनें और अपनी repository चुनें। Render `render.yaml` पढ़कर web service बनाएगा।
4. Setup के दौरान `ADMIN_PASSWORD` के लिए एक unique, लंबा password सेट करें (कम-से-कम 14 characters; बेहतर 20+). इसे GitHub या code file में न लिखें। `SESSION_SECRET` Render अपने-आप generate करेगा।
5. Deploy पूरा होने पर Render आपको `https://...onrender.com` URL देगा। इसी लिंक को छात्रों के साथ साझा करें। पहले खुद Student और Admin दोनों तरीकों से test करें।
6. Custom domain चाहिए तो Render की service settings में **Custom Domains** खोलकर अपना domain जोड़ें और domain provider में Render द्वारा बताए DNS records डालें। HTTPS certificate active होने तक प्रतीक्षा करें।

**ध्यान दें:** `render.yaml` में persistent disk वाला paid `starter` web service चुना गया है ताकि SQLite database restart/deploy के बाद बना रहे। Free/ephemeral hosting पर database खो सकता है। Provider के plan/pricing में बदलाव हो सकते हैं—deploy से पहले वर्तमान कीमत और limits देख लें।

## पूरा कंट्रोल किसके पास रहेगा?

- **आप/Website Owner:** GitHub repository, Render hosting account, domain registrar और billing account अपने ईमेल/2-step verification पर रखें। इन्हीं खातों का मालिक website, deployments, environment secrets, backups और domain को नियंत्रित करेगा। किसी अनजान व्यक्ति को account password न दें।
- **Admin/Quiz Controller:** वेबसाइट में Admin login से quizzes create/edit कर सकता है, attempts/results देख सकता है और CSV export कर सकता है। Admin password केवल भरोसेमंद owner के पास रहे।
- **Students:** केवल quiz attempt कर सकते हैं और अपने session में अपना result/review देख सकते हैं; वे quiz edit/delete या सभी छात्रों के results नहीं देख सकते।
- **Code/Hosting Control बनाम Quiz Control:** वेबसाइट के अंदर Admin access देने का अर्थ यह नहीं कि वह व्यक्ति server code या hosting settings भी बदल सकता है। Code/hosting access अलग से GitHub/Render account permissions से दिया जाता है—इसे केवल भरोसेमंद तकनीकी व्यक्ति को दें।

## Live करने के बाद checklist

- Admin password और email accounts पर 2-step verification चालू करें।
- Live URL को incognito/private window में Student की तरह जाँचें; Admin APIs को बिना login access नहीं होना चाहिए।
- Results/SQLite data के नियमित backups लें और restore की प्रक्रिया जाँचें।
- Public करने से पहले privacy notice जोड़ें—खासकर छात्र का मोबाइल नंबर क्यों लिया जा रहा है, कौन देख सकता है, और कितने समय तक रखा जाएगा। अभी मोबाइल OTP verification शामिल नहीं है।
- यह secure starter configuration है, स्वतंत्र penetration test या formal security audit का विकल्प नहीं।


## नए अपडेट (Quiz-wise Results, PDF और Photos)
- Admin panel में `PDF & Photo Manager` से PDF/क्लास नोट्स (PDF) या JPG/PNG/WEBP/GIF फोटो अपलोड करें। प्रति फाइल सीमा 12 MB है।
- स्टूडेंट होम पेज पर `Class PDFs & Study Material` और `Photo Gallery` देख सकते हैं।
- Admin के रिजल्ट अब हर क्विज़ के अलग-अलग expandable समूह में दिखेंगे।
- Upload/delete केवल Admin session से किया जा सकता है।

### Render पर जरूरी Persistent Disk सेटिंग
Render के free ephemeral filesystem पर restart/deploy के बाद SQLite और अपलोड की गई फाइलें खो सकती हैं। स्थायी डेटा के लिए Render service में persistent disk जोड़ें (mount path `/var/data`) और Environment में ये values रखें:
- `DB_PATH` = `/var/data/gkgs.sqlite`
- `UPLOADS_DIR` = `/var/data/uploads`
- `NODE_ENV` = `production`
- `SESSION_SECRET` = कम-से-कम 32 अक्षरों का random secret
- `ADMIN_PASSWORD` = अपना मजबूत, निजी पासवर्ड (कम-से-कम 14 characters)

`package.json` Node 22.x उपयोग करता है ताकि native SQLite dependency का Node 26 के साथ build issue न हो। नया code GitHub में push/upload करने के बाद Render पर redeploy करें। पहले से जमा पुराने results SQLite database में होंगे; database/file backup के बिना database path बदलने से वे दिखाई नहीं देंगे।
