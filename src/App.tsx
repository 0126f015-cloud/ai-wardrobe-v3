import React, { useState, useEffect } from 'react';
import { Camera, Plus, Trash2, Shirt, CheckCircle2, CloudSun, Sparkles, Loader2, X, User, Wand2, Ruler, ThermometerSun, Pencil, LayoutGrid, Home, Download, Link as LinkIcon, LogIn } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, query } from 'firebase/firestore';

// --- Global Variables (Provided by environment) ---
const firebaseConfig = JSON.parse(typeof window !== 'undefined' && (window as any).__firebase_config || '{}');
const appId = typeof window !== 'undefined' && (window as any).__app_id ? (window as any).__app_id : 'default-app-id';
const apiKey = ""; // 請填入您的 Google Gemini API Key

// --- Firebase Init ---
let db: any;
let auth: any;
try {
    if (Object.keys(firebaseConfig).length > 0) {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    }
} catch (e) {
    console.warn("Firebase not initialized");
}

// --- Utils: Image Compression ---
const compressImage = (base64Str: string, maxWidth = 600): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ratio = maxWidth / img.width;
            if (ratio >= 1) return resolve(base64Str);
            canvas.width = maxWidth;
            canvas.height = img.height * ratio;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(base64Str);
    });
};

// --- Gemini API ---
interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string; }; }

const callGemini = async (prompt: string, imageBase64?: string) => {
  try {
    const parts: GeminiPart[] = [{ text: prompt }];
    if (imageBase64) {
      const base64Data = imageBase64.split(',')[1] || imageBase64;
      parts.push({ inlineData: { mimeType: "image/jpeg", data: base64Data } });
    }
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } })
      }
    );
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
  } catch (error) { console.error("Gemini API Error:", error); throw error; }
};

const callGeminiImageToImage = async (prompt: string, imageBase64: string) => {
  try {
    const base64Data = imageBase64.split(',')[1] || imageBase64;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Data } }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        })
      }
    );
    if (!response.ok) throw new Error('Image generation failed');
    const data = await response.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (imagePart) return `data:image/jpeg;base64,${imagePart.inlineData.data}`;
    throw new Error('No image generated');
  } catch (error) { console.error("Gemini Image Gen Error:", error); throw error; }
};

// --- Types ---
type Category = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';
interface ClothingItem { id: string; image: string; category: Category; name: string; syncId?: string; }
interface BodyStats { height: string; weight: string; shoulder: string; chest: string; waist: string; lowWaist: string; hips: string; pantsLength: string; thigh: string; calf: string; description: string; }

const App = () => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [syncId, setSyncId] = useState<string>(""); 
  const [isSyncing, setIsSyncing] = useState(false); 

  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<ClothingItem[]>([]);
  const [activeTab, setActiveTab] = useState<Category | 'all'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditingStats, setIsEditingStats] = useState(false);
  const [bodyImage, setBodyImage] = useState<string | null>(null);
  const [bodyStats, setBodyStats] = useState<BodyStats>({ height: '172', weight: '75', shoulder: '47', chest: '103', waist: '82', lowWaist: '91', hips: '94', pantsLength: '86', thigh: '59', calf: '47', description: '肩膀多肌肉，大腿結實，健壯體格' });
  
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<Category>('top');
  const [newItemImage, setNewItemImage] = useState<string | null>(null);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [weatherAdvice, setWeatherAdvice] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isGeneratingTryOn, setIsGeneratingTryOn] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [currentWeather, setCurrentWeather] = useState("氣溫 22°C，多雲");

  useEffect(() => {
    const initAuth = async () => { if (auth) await signInAnonymously(auth); };
    initAuth();
    const unsubscribe = auth ? onAuthStateChanged(auth, setUser) : () => {};
    const savedSyncId = localStorage.getItem('my_wardrobe_sync_id');
    if (savedSyncId) { setSyncId(savedSyncId); setIsSyncing(true); }
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db || !isSyncing || !syncId) return;
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'wardrobe_items'));
    const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const items: ClothingItem[] = [];
        snapshot.forEach((doc) => {
            const data = doc.data() as any;
            if (data.syncId === syncId) items.push({ id: doc.id, ...data });
        });
        setWardrobe(items);
    });
    return () => unsubscribeSnapshot();
  }, [user, isSyncing, syncId]);

  const handleStartSync = () => { if (!syncId.trim()) return; localStorage.setItem('my_wardrobe_sync_id', syncId); setIsSyncing(true); };
  const handleLogout = () => { localStorage.removeItem('my_wardrobe_sync_id'); setIsSyncing(false); setSyncId(""); setWardrobe([]); };

  const addItemToWardrobe = async () => {
    if (!newItemName || !newItemImage) return;
    const compressedImage = await compressImage(newItemImage);
    const newItem = { name: newItemName, category: newItemCategory, image: compressedImage, syncId: syncId, createdAt: Date.now() };
    if (db && user) { try { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'wardrobe_items'), newItem); } catch (e) { alert("上傳失敗"); } } 
    else { const localItem = { ...newItem, id: Date.now().toString() } as ClothingItem; setWardrobe([...wardrobe, localItem]); }
    setNewItemName(''); setNewItemImage(null); setIsAdding(false);
  };

  const deleteFromWardrobe = async (id: string) => {
    if (!confirm('確定刪除？')) return;
    if (db && user) { try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'wardrobe_items', id)); } catch (e) { alert("刪除失敗"); } } 
    else { setWardrobe(wardrobe.filter(item => item.id !== id)); }
    setSelectedItems(selectedItems.filter(item => item.id !== id));
  };

  const handleAutoTag = async () => {
    if (!newItemImage) return;
    setIsAutoTagging(true);
    try {
      const prompt = `Analyze clothing image. Return JSON: {"name": "Trad. Chinese Name", "category": "top"|"bottom"|"outerwear"|"shoes"|"accessory"}`;
      const result = await callGemini(prompt, newItemImage);
      if (result.name) setNewItemName(result.name);
      if (result.category) setNewItemCategory(result.category as Category);
    } catch (error) { alert("AI 辨識失敗"); } finally { setIsAutoTagging(false); }
  };

  const toggleSelection = (item: ClothingItem) => {
    if (selectedItems.find(i => i.id === item.id)) setSelectedItems(prev => prev.filter(i => i.id !== item.id));
    else setSelectedItems(prev => [...prev, item]);
  };

  const clearSelection = () => { setSelectedItems([]); setWeatherAdvice(null); };

  const handleWeatherRecommendation = async () => {
    if (wardrobe.length === 0) { alert("請先新增衣物！"); return; }
    setIsThinking(true); setWeatherAdvice(null); setSelectedItems([]);
    try {
        const weathers = ["氣溫 12°C，寒流，雨", "氣溫 28°C，晴朗", "氣溫 20°C，舒適", "氣溫 16°C，多風"];
        const randomWeather = weathers[Math.floor(Math.random() * weathers.length)];
        setCurrentWeather(randomWeather);
        const prompt = `Weather: ${randomWeather}. Wardrobe: ${JSON.stringify(wardrobe.map(i=>({id:i.id,name:i.name,cat:i.category})))}. Body: ${bodyStats.description}. Pick BEST outfit. Return JSON: {"selectedIds": ["id1"...], "reason": "Chinese reason"}`;
        const result = await callGemini(prompt);
        if (result.selectedIds) setSelectedItems(wardrobe.filter(item => result.selectedIds.includes(item.id)));
        if (result.reason) setWeatherAdvice(result.reason);
    } catch (error) { alert("AI 忙線中"); } finally { setIsThinking(false); }
  };

  const handleVirtualTryOn = async () => {
    if (selectedItems.length === 0) return;
    setIsGeneratingTryOn(true); setGeneratedImage(null);
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 1200; canvas.height = 800;
      if (ctx) {
          ctx.fillStyle='#fff'; ctx.fillRect(0,0,1200,800);
          if (bodyImage) {
              const img = await new Promise<HTMLImageElement>(r=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>r(i);i.src=bodyImage!});
              const scale = Math.min(600/img.width, 800/img.height)*0.9;
              ctx.drawImage(img, (600-img.width*scale)/2, (800-img.height*scale)/2, img.width*scale, img.height*scale);
          }
          ctx.fillStyle='#f8fafc'; ctx.fillRect(600,0,600,800);
          for(let i=0; i<selectedItems.length; i++) {
              const item = selectedItems[i];
              const img = await new Promise<HTMLImageElement>(r=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>r(image);image.src=item.image});
              const scale = Math.min(300/img.width, 400/img.height)*0.8;
              const x = 600 + (i%2)*300 + (300-img.width*scale)/2;
              const y = Math.floor(i/2)*400 + (400-img.height*scale)/2;
              ctx.drawImage(img, x, y, img.width*scale, img.height*scale);
          }
      }
      const composite = canvas.toDataURL('image/jpeg', 0.8);
      const prompt = bodyImage 
        ? `Input: Left=User, Right=Clothes. Task: Generate realistic photo of User wearing Clothes. Keep User's face/body(${bodyStats.height}cm/${bodyStats.weight}kg). Replace outfit.`
        : `Task: Generate realistic photo of man(${bodyStats.height}cm/${bodyStats.weight}kg) wearing these clothes.`;
      const res = await callGeminiImageToImage(prompt, composite);
      setGeneratedImage(res);
    } catch (e) { alert("生成失敗"); } finally { setIsGeneratingTryOn(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const r = new FileReader(); r.onloadend = () => { setNewItemImage(r.result as string); setNewItemName(''); }; r.readAsDataURL(file); }
  };
  const handleBodyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const r = new FileReader(); r.onloadend = () => { setBodyImage(r.result as string); }; r.readAsDataURL(file); }
  };

  const CategoryBadge = ({ cat }: { cat: Category }) => {
    const map = { top: '上身', bottom: '下身', outerwear: '外套', shoes: '鞋子', accessory: '配件' };
    const color = { top: 'bg-blue-100 text-blue-800', bottom: 'bg-green-100 text-green-800', outerwear: 'bg-purple-100 text-purple-800', shoes: 'bg-orange-100 text-orange-800', accessory: 'bg-pink-100 text-pink-800' };
    return <span className={`text-xs px-2 py-1 rounded-full ${color[cat]}`}>{map[cat]}</span>;
  };

  const LogOutIcon = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
  );

  if (!isSyncing) {
      return (
          <div className="flex flex-col h-screen bg-slate-50 items-center justify-center p-6">
              <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-sm text-center">
                  <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CloudSun size={32} className="text-indigo-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-slate-800 mb-2">歡迎來到 AI 風格管家</h1>
                  <p className="text-slate-500 text-sm mb-8">請輸入一個「房間代碼」，讓您的手機與電腦同步連線。</p>
                  
                  <div className="space-y-4">
                      <div className="text-left">
                          <label className="text-xs font-bold text-slate-700 ml-1">房間代碼 (Sync ID)</label>
                          <input type="text" value={syncId} onChange={(e) => setSyncId(e.target.value)} placeholder="例如：andy888" className="w-full mt-1 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                      </div>
                      <button onClick={handleStartSync} disabled={!syncId.trim()} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:scale-100">
                          開始同步 <LogIn size={18} className="inline ml-1" />
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50 text-slate-800 font-sans overflow-hidden">
      <header className="bg-white shadow-sm px-4 py-3 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2"><div className="p-2 bg-indigo-600 rounded-lg shadow-md"><Shirt className="w-5 h-5 text-white" /></div><div><h1 className="text-lg font-bold text-slate-800 tracking-tight">AI 風格管家</h1><div className="flex items-center gap-1 text-[10px] text-slate-400"><LinkIcon size={10} /> 房間: {syncId}</div></div></div>
        <div className="flex gap-2">
            <button onClick={handleLogout} className="text-slate-400 p-2 hover:bg-slate-100 rounded-lg"><LogOutIcon size={18}/></button>
            <button onClick={handleWeatherRecommendation} disabled={isThinking} className="bg-sky-50 text-sky-600 px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">{isThinking ? <Loader2 size={16} className="animate-spin" /> : <CloudSun size={16} />} 天氣</button>
            <button onClick={() => setIsAdding(true)} className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold shadow-md whitespace-nowrap"><Plus size={16} /> 新增</button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto md:overflow-hidden relative flex flex-col md:flex-row">
        <div className="w-full md:flex-1 shrink-0 p-4 bg-slate-50/50 flex flex-col gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 flex gap-3 items-start shrink-0">
             <div className="relative group shrink-0">
                 <div className="w-16 h-20 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-100 shadow-inner">{bodyImage ? <img src={bodyImage} alt="User" className="w-full h-full object-cover" /> : <User className="text-slate-300 w-8 h-8" />}</div>
                 <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg cursor-pointer text-white"><Camera size={16}/><input type="file" accept="image/*" onChange={handleBodyUpload} className="hidden" /></label>
             </div>
             <div className="flex-1 min-w-0">
                 <div className="flex justify-between items-start"><h3 className="font-bold text-slate-800 text-sm">您的身型檔案</h3><button onClick={() => setIsEditingStats(true)} className="text-indigo-600 p-1 bg-indigo-50 rounded-lg"><Pencil size={14} /></button></div>
                 <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1 mt-1 text-[10px] text-slate-600 font-medium"><span className="truncate">身高: {bodyStats.height}cm</span><span className="truncate">體重: {bodyStats.weight}kg</span><span className="truncate">肩寬: {bodyStats.shoulder}cm</span></div>
             </div>
          </div>
          <div className="flex justify-between items-end shrink-0">
            <div><h2 className="text-lg font-bold text-slate-800">搭配清單</h2><div className="flex items-center gap-1 mt-0.5 text-xs text-slate-500"><ThermometerSun size={12} /><span>{currentWeather}</span></div></div>
            <div className="flex gap-2">
                {selectedItems.length > 0 && <button onClick={clearSelection} className="px-3 py-1.5 text-slate-500 hover:bg-slate-200 rounded-lg text-xs">清空</button>}
                <button onClick={handleVirtualTryOn} disabled={selectedItems.length === 0 || isGeneratingTryOn} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-50">{isGeneratingTryOn ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} 生成試穿</button>
            </div>
          </div>
          {weatherAdvice && <div className="bg-white border border-sky-100 p-3 rounded-2xl shadow-sm flex gap-3 items-start animate-in slide-in-from-top-2 shrink-0"><div className="p-1.5 bg-sky-100 rounded-full shrink-0"><Sparkles className="w-4 h-4 text-sky-600" /></div><div><h3 className="font-bold text-sky-900 text-xs mb-1">AI 建議</h3><p className="text-slate-600 text-xs leading-relaxed">{weatherAdvice}</p></div><button onClick={() => setWeatherAdvice(null)} className="ml-auto text-slate-400 hover:text-slate-600"><X size={14} /></button></div>}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 overflow-y-auto min-h-[150px] md:h-full md:flex-1">
            {selectedItems.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 py-8"><div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center"><Shirt size={32} className="opacity-50" /></div><p className="text-sm text-center">點擊下方衣櫃選擇單品。</p></div> : <div className="grid grid-cols-3 gap-3">{selectedItems.map((item, idx) => <div key={`${item.id}-${idx}`} className="group relative bg-slate-50 rounded-xl p-2 border border-slate-100 flex flex-col items-center animate-in zoom-in-50"><img src={item.image} alt={item.name} className="w-20 h-20 object-contain mb-2" /><button onClick={() => toggleSelection(item)} className="absolute top-1 right-1 p-1 bg-white text-rose-500 rounded-full shadow-sm"><X size={12} /></button></div>)}</div>}
          </div>
        </div>
        <div className="w-full md:w-96 shrink-0 bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col shadow-xl z-20">
          <div className="p-4 border-b border-slate-100 shrink-0 sticky top-0 bg-white z-10">
            <h2 className="font-bold text-slate-800 mb-3 text-lg">我的衣櫃庫存</h2>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">{(['all', 'top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const).map(cat => <button key={cat} onClick={() => setActiveTab(cat)} className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${activeTab === cat ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-600'}`}>{{all:'全部',top:'上身',bottom:'下身',outerwear:'外套',shoes:'鞋子',accessory:'配件'}[cat]}</button>)}</div>
          </div>
          <div className="p-4 bg-slate-50/50 min-h-[300px] md:h-full md:overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              {wardrobe.filter(item => activeTab === 'all' || item.category === activeTab).map(item => <div key={item.id} className={`group relative bg-white rounded-xl overflow-hidden border transition-all cursor-pointer hover:shadow-md active:scale-95 ${selectedItems.find(i => i.id === item.id) ? 'ring-2 ring-indigo-500 border-transparent' : 'border-slate-200'}`} onClick={() => toggleSelection(item)}>{selectedItems.find(i => i.id === item.id) && <div className="absolute top-2 left-2 z-10 bg-indigo-500 text-white p-1 rounded-full shadow-md"><CheckCircle2 size={12} /></div>}<div className="aspect-square w-full p-3 flex items-center justify-center"><img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain" /></div><div className="p-2 border-t border-slate-50 flex justify-between items-center"><p className="text-xs font-medium text-slate-700 truncate flex-1">{item.name}</p><button onClick={(e) => { e.stopPropagation(); deleteFromWardrobe(item.id); }} className="text-slate-300 hover:text-rose-500"><Trash2 size={14} /></button></div></div>)}
            </div>
          </div>
        </div>
      </div>
      {generatedImage && <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in"><div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl relative"><button onClick={() => setGeneratedImage(null)} className="absolute top-3 right-3 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 z-10"><X size={20} /></button><div className="p-6 border-b"><h3 className="font-bold text-xl text-slate-800 flex items-center gap-2"><Wand2 className="text-indigo-600" size={24}/>AI 擬真試穿結果</h3></div><div className="bg-slate-100 flex justify-center p-4"><img src={generatedImage} alt="Virtual Try On" className="max-h-[60vh] w-auto object-contain rounded-lg shadow-sm" /></div><div className="p-6 flex justify-center"><a href={generatedImage} download="tryon.jpg" className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg"><Download size={18} /> 下載圖片</a></div></div></div>}
      {isEditingStats && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[90vh]"><div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Ruler size={18} className="text-indigo-600"/>身型資料設定</h3><button onClick={() => setIsEditingStats(false)}><X size={20} className="text-slate-400" /></button></div><div className="p-6 space-y-4 overflow-y-auto"><div className="grid grid-cols-2 gap-4">{Object.keys(bodyStats).map((key) => { if (key === 'description') return null; return <div key={key}><label className="block text-xs font-medium text-slate-500 mb-1 capitalize">{key}</label><input type="text" value={bodyStats[key as keyof BodyStats]} onChange={e => setBodyStats({...bodyStats, [key]: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none" /></div> })}</div><div><label className="block text-xs font-medium text-slate-500 mb-1">描述</label><textarea value={bodyStats.description} onChange={e => setBodyStats({...bodyStats, description: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none" rows={2} /></div></div><div className="p-4 border-t bg-slate-50 flex justify-end"><button onClick={() => setIsEditingStats(false)} className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg">儲存</button></div></div></div>}
      {isAdding && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[90vh]"><div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-bold text-slate-800">新增服飾</h3><button onClick={() => setIsAdding(false)}><X size={20} className="text-slate-400" /></button></div><div className="p-6 space-y-4 overflow-y-auto"><div className="relative group cursor-pointer shrink-0"><input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" /><div className={`w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-colors ${newItemImage ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50'}`}>{newItemImage ? <img src={newItemImage} alt="Preview" className="w-full h-full object-contain p-2" /> : <><Camera className="w-8 h-8 text-slate-400 mb-2" /><span className="text-sm text-slate-500">點擊上傳</span></>}</div></div>{newItemImage && <button onClick={handleAutoTag} disabled={isAutoTagging} className="w-full py-2 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-lg text-sm font-medium shadow-md flex items-center justify-center gap-2">{isAutoTagging ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} AI 自動辨識</button>}<div><label className="block text-xs font-medium text-slate-700 mb-1">名稱</label><input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300" /></div><div><label className="block text-xs font-medium text-slate-700 mb-1">分類</label><div className="grid grid-cols-3 gap-2">{(['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const).map(cat => <button key={cat} onClick={() => setNewItemCategory(cat)} className={`py-2 px-1 text-xs rounded-lg border transition-all ${newItemCategory === cat ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>{cat}</button>)}</div></div></div><div className="p-4 border-t bg-slate-50 flex justify-end gap-2"><button onClick={() => setIsAdding(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">取消</button><button onClick={addItemToWardrobe} disabled={!newItemName || !newItemImage} className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">新增</button></div></div></div>}
    </div>
  );
};

export default App;
