import React, { useState, useEffect } from 'react';
import { Camera, Plus, Trash2, Shirt, CheckCircle2, CloudSun, Sparkles, Loader2, X, User, Wand2, Ruler, ThermometerSun, Pencil, Download } from 'lucide-react';

// --- Gemini API Configuration ---
const apiKey = ""; 

// 定義 Gemini API 的請求結構類型
interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

// Helper to call Gemini API
const callGemini = async (prompt: string, imageBase64?: string) => {
  try {
    const parts: GeminiPart[] = [{ text: prompt }];
    
    if (imageBase64) {
      const base64Data = imageBase64.split(',')[1] || imageBase64;
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No content generated');
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

// Image-to-Image Generation for Virtual Try-On
const callGeminiImageToImage = async (prompt: string, imageBase64: string) => {
  try {
    const base64Data = imageBase64.split(',')[1] || imageBase64;
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
          }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        })
      }
    );

    if (!response.ok) throw new Error('Image generation failed');
    
    const data = await response.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    
    if (imagePart) {
      return `data:image/jpeg;base64,${imagePart.inlineData.data}`;
    }
    throw new Error('No image generated');
  } catch (error) {
    console.error("Gemini Image Gen Error:", error);
    throw error;
  }
};


// --- Types ---
type Category = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';

interface ClothingItem {
  id: string;
  image: string; // Base64 image
  category: Category;
  name: string;
}

interface BodyStats {
  height: string;
  weight: string;
  shoulder: string;
  chest: string;
  waist: string;
  lowWaist: string;
  hips: string;
  pantsLength: string;
  thigh: string;
  calf: string;
  description: string;
}

const App = () => {
  // --- State ---
  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<ClothingItem[]>([]);
  
  const [activeTab, setActiveTab] = useState<Category | 'all'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditingStats, setIsEditingStats] = useState(false);
  
  // Removed mobileView state (No longer needed for vertical scroll layout)

  // Body Model State
  const [bodyImage, setBodyImage] = useState<string | null>(null);
  
  // Body Stats State
  const [bodyStats, setBodyStats] = useState<BodyStats>({
    height: '172',
    weight: '75',
    shoulder: '47',
    chest: '103',
    waist: '82',
    lowWaist: '91',
    hips: '94',
    pantsLength: '86',
    thigh: '59',
    calf: '47',
    description: '肩膀多肌肉，大腿結實，健壯體格'
  });

  // AI States
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<Category>('top');
  const [newItemImage, setNewItemImage] = useState<string | null>(null);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  
  // Recommendation States
  const [weatherAdvice, setWeatherAdvice] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  
  const [isGeneratingTryOn, setIsGeneratingTryOn] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  // Weather Simulation
  const [currentWeather, setCurrentWeather] = useState("氣溫 22°C，多雲");

  // 初始化
  useEffect(() => {
    const savedWardrobe = localStorage.getItem('my_wardrobe');
    if (savedWardrobe) {
      setWardrobe(JSON.parse(savedWardrobe));
    }
    const savedBody = localStorage.getItem('my_body_model');
    if (savedBody) {
      setBodyImage(savedBody);
    }
    const savedStats = localStorage.getItem('my_body_stats');
    if (savedStats) {
      const parsed = JSON.parse(savedStats);
      setBodyStats(prev => ({ ...prev, ...parsed }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('my_wardrobe', JSON.stringify(wardrobe));
  }, [wardrobe]);

  useEffect(() => {
    if (bodyImage) localStorage.setItem('my_body_model', bodyImage);
  }, [bodyImage]);

  useEffect(() => {
    localStorage.setItem('my_body_stats', JSON.stringify(bodyStats));
  }, [bodyStats]);

  // --- Handlers: Core Logic ---

  const toggleSelection = (item: ClothingItem) => {
    if (selectedItems.find(i => i.id === item.id)) {
        setSelectedItems(prev => prev.filter(i => i.id !== item.id));
    } else {
        setSelectedItems(prev => [...prev, item]);
    }
  };

  const clearSelection = () => {
    setSelectedItems([]);
    setWeatherAdvice(null);
  };

  // --- Handlers: AI Features ---

  const handleAutoTag = async () => {
    if (!newItemImage) return;
    setIsAutoTagging(true);
    try {
      const prompt = `
        Analyze this clothing image. 
        Return a JSON object with two fields: 
        1. "name": A short, creative name for this item in Traditional Chinese. Max 10 chars.
        2. "category": One of these exact strings: "top", "bottom", "outerwear", "shoes", "accessory".
      `;
      const result = await callGemini(prompt, newItemImage);
      if (result.name) setNewItemName(result.name);
      if (result.category) setNewItemCategory(result.category as Category);
    } catch (error) {
      alert("AI 辨識失敗，請手動輸入");
    } finally {
      setIsAutoTagging(false);
    }
  };

  const handleWeatherRecommendation = async () => {
    if (wardrobe.length === 0) {
        alert("衣櫃是空的，請先新增衣物！");
        return;
    }
    setIsThinking(true);
    setWeatherAdvice(null);
    setSelectedItems([]);

    try {
        const weathers = ["氣溫 12°C，寒流來襲，下雨", "氣溫 28°C，炎熱晴朗", "氣溫 20°C，舒適涼爽", "氣溫 16°C，風大"];
        const randomWeather = weathers[Math.floor(Math.random() * weathers.length)];
        setCurrentWeather(randomWeather);

        const wardrobeList = wardrobe.map(item => ({
            id: item.id,
            name: item.name,
            category: item.category
        }));

        const prompt = `
            Current Weather: ${randomWeather}.
            User Wardrobe: ${JSON.stringify(wardrobeList)}.
            User Body Style: ${bodyStats.description}.
            
            Task:
            1. Select the BEST outfit combination from the wardrobe for this weather.
            2. Return a JSON object:
               {
                 "selectedIds": ["id1", "id2", ...],
                 "reason": "Traditional Chinese explanation of why this outfit fits the weather and style."
               }
        `;

        const result = await callGemini(prompt);
        
        if (result.selectedIds) {
            const aiSelectedItems = wardrobe.filter(item => result.selectedIds.includes(item.id));
            setSelectedItems(aiSelectedItems);
        }
        if (result.reason) {
            setWeatherAdvice(result.reason);
        }

    } catch (error) {
        alert("AI 推薦失敗，請稍後再試");
    } finally {
        setIsThinking(false);
    }
  };

  // Helper: Auto-arrange items into a grid image for AI input
  const createOutfitGrid = async (): Promise<string> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const width = 1200; 
      const height = 800;
      canvas.width = width;
      canvas.height = height;
      
      if (!ctx) return resolve('');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      const items = selectedItems;
      const count = items.length;
      
      const drawBody = async () => {
         if (bodyImage) {
             return new Promise<void>((r) => {
                 const img = new Image();
                 img.crossOrigin = "anonymous";
                 img.onload = () => {
                     const areaW = width * 0.5;
                     const areaH = height;
                     const scale = Math.min(areaW / img.width, areaH / img.height) * 0.9;
                     const w = img.width * scale;
                     const h = img.height * scale;
                     const x = (areaW - w) / 2;
                     const y = (areaH - h) / 2;
                     ctx.drawImage(img, x, y, w, h);
                     
                     ctx.fillStyle = "#333";
                     ctx.font = "bold 24px Arial";
                     ctx.fillText("Reference Face/Body", 20, 40);
                     r();
                 };
                 img.src = bodyImage;
             });
         }
         return Promise.resolve();
      };

      const drawClothes = async () => {
         const startX = width * 0.5;
         const areaW = width * 0.5;
         
         ctx.fillStyle = "#f8fafc";
         ctx.fillRect(startX, 0, areaW, height);
         
         ctx.fillStyle = "#333";
         ctx.font = "bold 24px Arial";
         ctx.fillText("Clothes to Wear", startX + 20, 40);

         const loadAndDraw = async (item: ClothingItem, idx: number) => {
            return new Promise<void>((r) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    let dx = 0, dy = 0, dw = areaW, dh = height;
                    
                    if (count === 1) {
                        dw = areaW * 0.7; dh = height * 0.6;
                        dx = startX + (areaW - dw) / 2; dy = (height - dh) / 2;
                    } else if (count === 2) {
                        dw = areaW / 2; dh = height * 0.5;
                        dx = startX + (idx * dw); dy = (height - dh) / 2;
                    } else {
                        dw = areaW / 2; dh = height / 2;
                        dx = startX + (idx % 2) * dw;
                        dy = Math.floor(idx / 2) * dh;
                    }
                    
                    const scale = Math.min(dw / img.width, dh / img.height) * 0.8;
                    const finalW = img.width * scale;
                    const finalH = img.height * scale;
                    const centerX = dx + (dw - finalW) / 2;
                    const centerY = dy + (dh - finalH) / 2;

                    ctx.drawImage(img, centerX, centerY, finalW, finalH);
                    r();
                };
                img.src = item.image;
            });
         };

         for (let i = 0; i < items.length; i++) {
            await loadAndDraw(items[i], i);
         }
      };

      const process = async () => {
        await drawBody();
        await drawClothes();
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };

      process();
    });
  };

  const handleVirtualTryOn = async () => {
    if (selectedItems.length === 0) return;
    setIsGeneratingTryOn(true);
    setGeneratedImage(null);

    try {
      const compositeImage = await createOutfitGrid();
      
      const bodyDescription = `
        Height: ${bodyStats.height}cm, Weight: ${bodyStats.weight}kg.
        Shoulder width: ${bodyStats.shoulder}cm (Muscular).
        Chest: ${bodyStats.chest}cm.
        Waist: ${bodyStats.waist}cm, Hips: ${bodyStats.hips}cm.
        Thigh: ${bodyStats.thigh}cm.
        Physique: ${bodyStats.description}.
      `;

      let prompt = "";
      
      if (bodyImage) {
          prompt = `
            The input image contains two parts:
            1. Left side: Reference photo of the user (Focus on Face/Head).
            2. Right side: Clothing items.

            Task: Generate a NEW photo of the user wearing the clothes.
            
            Instructions:
            1. **Face & Identity**: Use the face and head features from the person on the Left.
            2. **Body**: Must match these measurements: ${bodyDescription}. Note the muscular shoulders.
            3. **Outfit**: The person MUST BE WEARING the clothes shown on the Right. Replace any original clothes.
            4. **Pose & Background**: Ignore the original photo's pose and background. Generate a new natural standing pose in a clean, bright, neutral studio background.
            5. **Quality**: Photorealistic, high quality.
          `;
      } else {
          prompt = `
            The input image shows clothing items.
            Task: Generate a realistic photo of a man WEARING these clothes.
            
            Target Body Specs:
            ${bodyDescription}

            Instructions:
            1. Generate a photorealistic image of a man fitting these specific measurements.
            2. The man must be wearing the provided clothes.
            3. Use a clean, simple studio background.
          `;
      }
      
      const resultImage = await callGeminiImageToImage(prompt, compositeImage);
      setGeneratedImage(resultImage);

    } catch (error) {
      alert("AI 生成試穿圖失敗，請稍後再試。");
    } finally {
      setIsGeneratingTryOn(false);
    }
  };


  // --- Handlers: Upload ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewItemImage(reader.result as string);
        setNewItemName(''); 
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBodyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBodyImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const addItemToWardrobe = () => {
    if (!newItemName || !newItemImage) return;
    const newItem: ClothingItem = {
      id: Date.now().toString(),
      name: newItemName,
      category: newItemCategory,
      image: newItemImage
    };
    setWardrobe([...wardrobe, newItem]);
    setNewItemName('');
    setNewItemImage(null);
    setIsAdding(false);
  };

  const deleteFromWardrobe = (id: string) => {
    if (confirm('確定要從衣櫃刪除這件衣服嗎？')) {
      setWardrobe(wardrobe.filter(item => item.id !== id));
      setSelectedItems(selectedItems.filter(item => item.id !== id));
    }
  };

  // --- UI Components ---
  const CategoryBadge = ({ cat }: { cat: Category }) => {
    const colors: Record<Category, string> = {
      top: 'bg-blue-100 text-blue-800',
      bottom: 'bg-green-100 text-green-800',
      outerwear: 'bg-purple-100 text-purple-800',
      shoes: 'bg-orange-100 text-orange-800',
      accessory: 'bg-pink-100 text-pink-800'
    };
    const labels: Record<Category, string> = {
      top: '上身',
      bottom: '下身',
      outerwear: '外套',
      shoes: '鞋子',
      accessory: '配件'
    };
    return (
      <span className={`text-xs px-2 py-1 rounded-full ${colors[cat]}`}>
        {labels[cat]}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 py-3 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-md">
            <Shirt className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">AI 風格管家</h1>
          </div>
        </div>
        
        {/* Top Actions */}
        <div className="flex gap-2">
            <button 
                onClick={handleWeatherRecommendation}
                disabled={isThinking}
                className="bg-sky-50 text-sky-600 px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold hover:bg-sky-100 transition-colors border border-sky-100 whitespace-nowrap"
            >
                {isThinking ? <Loader2 size={16} className="animate-spin" /> : <CloudSun size={16} />}
                {isThinking ? "分析中..." : "天氣推薦"}
            </button>
            <button 
                onClick={() => setIsAdding(true)}
                className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200 whitespace-nowrap"
            >
                <Plus size={16} />
                新增
            </button>
        </div>
      </header>

      {/* Main Content Area - Modified for Vertical Scroll on Mobile */}
      <div className="flex-1 overflow-y-auto md:overflow-hidden relative flex flex-col md:flex-row">
        
        {/* Left: Fitting Room (Top on mobile) */}
        <div className="w-full md:flex-1 shrink-0 p-4 bg-slate-50/50 flex flex-col gap-4">
          
          {/* Personal Model Profile Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 flex gap-3 items-start shrink-0">
             <div className="relative group shrink-0">
                 <div className="w-16 h-20 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-100 shadow-inner">
                     {bodyImage ? (
                         <img src={bodyImage} alt="User Body" className="w-full h-full object-cover" />
                     ) : (
                         <User className="text-slate-300 w-8 h-8" />
                     )}
                 </div>
                 <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg cursor-pointer text-white text-xs font-medium">
                     <Camera size={16}/>
                     <input type="file" accept="image/*" onChange={handleBodyUpload} className="hidden" />
                 </label>
             </div>

             <div className="flex-1 min-w-0">
                 <div className="flex justify-between items-start">
                     <h3 className="font-bold text-slate-800 text-sm">您的身型檔案</h3>
                     <button onClick={() => setIsEditingStats(true)} className="text-indigo-600 hover:text-indigo-700 p-1 bg-indigo-50 rounded-lg transition-colors">
                         <Pencil size={14} />
                     </button>
                 </div>
                 <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1 mt-1 text-[10px] text-slate-600 font-medium">
                     <span className="truncate">身高: {bodyStats.height}cm</span>
                     <span className="truncate">體重: {bodyStats.weight}kg</span>
                     <span className="truncate">肩寬: {bodyStats.shoulder}cm</span>
                     <span className="truncate hidden sm:inline">體態: {bodyStats.description.substring(0,6)}...</span>
                 </div>
             </div>
          </div>

          <div className="flex justify-between items-end shrink-0">
            <div>
                <h2 className="text-lg font-bold text-slate-800">搭配清單</h2>
                <div className="flex items-center gap-1 mt-0.5 text-xs text-slate-500">
                    <ThermometerSun size={12} />
                    <span>{currentWeather}</span>
                </div>
            </div>
            
            <div className="flex gap-2">
                {selectedItems.length > 0 && (
                    <button 
                        onClick={clearSelection}
                        className="px-3 py-1.5 text-slate-500 hover:bg-slate-200 rounded-lg text-xs transition-colors"
                    >
                        清空
                    </button>
                )}
                <button 
                    onClick={handleVirtualTryOn}
                    disabled={selectedItems.length === 0 || isGeneratingTryOn}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-bold shadow-md shadow-indigo-200 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isGeneratingTryOn ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    生成試穿
                </button>
            </div>
          </div>

          {/* AI Recommendation Box */}
          {weatherAdvice && (
            <div className="bg-white border border-sky-100 p-3 rounded-2xl shadow-sm flex gap-3 items-start animate-in slide-in-from-top-2 shrink-0">
                <div className="p-1.5 bg-sky-100 rounded-full shrink-0">
                    <Sparkles className="w-4 h-4 text-sky-600" />
                </div>
                <div>
                    <h3 className="font-bold text-sky-900 text-xs mb-1">AI 建議</h3>
                    <p className="text-slate-600 text-xs leading-relaxed">{weatherAdvice}</p>
                </div>
                <button onClick={() => setWeatherAdvice(null)} className="ml-auto text-slate-400 hover:text-slate-600">
                    <X size={14} />
                </button>
            </div>
          )}

          {/* Selected Items Grid */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 overflow-y-auto min-h-[150px] md:h-full md:flex-1">
            {selectedItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 py-8">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center">
                        <Shirt size={32} className="opacity-50" />
                    </div>
                    <p className="text-sm text-center">
                        點擊下方衣櫃選擇單品，<br/>或使用上方「天氣推薦」。
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {selectedItems.map((item, idx) => (
                        <div key={`${item.id}-${idx}`} className="group relative bg-slate-50 rounded-xl p-2 border border-slate-100 flex flex-col items-center animate-in zoom-in-50 duration-200">
                            <img src={item.image} alt={item.name} className="w-24 h-24 object-contain mb-2 drop-shadow-sm" />
                            <span className="text-xs font-medium text-slate-700 truncate w-full text-center">{item.name}</span>
                            <div className="mt-1 transform scale-90">
                                <CategoryBadge cat={item.category} />
                            </div>
                            <button 
                                onClick={() => toggleSelection(item)}
                                className="absolute top-1 right-1 p-1 bg-white text-rose-500 rounded-full shadow-sm opacity-100 transition-all hover:bg-rose-50"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
          </div>
        </div>

        {/* Right: Wardrobe Sidebar (Bottom on mobile) */}
        <div className="w-full md:w-96 shrink-0 bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col shadow-xl z-20">
          <div className="p-4 border-b border-slate-100 shrink-0 sticky top-0 bg-white z-10">
            <h2 className="font-bold text-slate-800 mb-3 text-lg">我的衣櫃庫存</h2>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {(['all', 'top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveTab(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    activeTab === cat 
                      ? 'bg-slate-800 text-white shadow-md' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat === 'all' ? '全部' : 
                   cat === 'top' ? '上身' :
                   cat === 'bottom' ? '下身' :
                   cat === 'outerwear' ? '外套' :
                   cat === 'shoes' ? '鞋子' : '配件'}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 bg-slate-50/50 min-h-[300px] md:h-full md:overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              {wardrobe
                .filter(item => activeTab === 'all' || item.category === activeTab)
                .map(item => {
                  const isSelected = selectedItems.some(i => i.id === item.id);
                  return (
                    <div 
                        key={item.id} 
                        className={`group relative bg-white rounded-xl overflow-hidden border transition-all cursor-pointer hover:shadow-md active:scale-95 ${isSelected ? 'ring-2 ring-indigo-500 border-transparent' : 'border-slate-200 hover:border-indigo-300'}`}
                        onClick={() => toggleSelection(item)}
                    >
                        {isSelected && (
                            <div className="absolute top-2 left-2 z-10 bg-indigo-500 text-white p-1 rounded-full shadow-md animate-in zoom-in">
                                <CheckCircle2 size={12} />
                            </div>
                        )}
                        <div className="aspect-square w-full p-3 flex items-center justify-center">
                            <img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="p-2 border-t border-slate-50">
                            <p className="text-xs font-medium text-slate-700 truncate">{item.name}</p>
                            <div className="mt-1 opacity-70 transform scale-90 origin-left">
                                <CategoryBadge cat={item.category} />
                            </div>
                        </div>
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                deleteFromWardrobe(item.id);
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-white/90 rounded-full text-slate-400 opacity-100 transition-all hover:text-rose-500 hover:bg-rose-50"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                )})}

              {wardrobe.length === 0 && (
                <div className="col-span-2 text-center py-12 text-slate-400 text-sm">
                  衣櫃空空的<br/>點擊上方「新增」按鈕
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Generated Image Modal */}
      {generatedImage && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
             <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl relative">
                <button 
                    onClick={() => setGeneratedImage(null)}
                    className="absolute top-3 right-3 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 z-10 transition-colors"
                >
                    <X size={20} />
                </button>
                <div className="p-6 border-b">
                    <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                        <Wand2 className="text-indigo-600" size={24}/>
                        AI 擬真試穿結果
                    </h3>
                    <p className="text-slate-500 text-sm mt-1">為您合成的專屬試穿影像</p>
                </div>
                <div className="bg-slate-100 flex justify-center p-4">
                    <img src={generatedImage} alt="Virtual Try On" className="max-h-[60vh] w-auto object-contain rounded-lg shadow-sm" />
                </div>
                <div className="p-6 flex justify-center">
                    <a 
                        href={generatedImage} 
                        download="my-outfit-tryon.jpg"
                        className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-transform active:scale-95 shadow-lg shadow-indigo-200"
                    >
                        <Download size={18} /> 下載圖片
                    </a>
                </div>
             </div>
        </div>
      )}

      {/* Body Stats Modal */}
      {isEditingStats && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Ruler size={18} className="text-indigo-600"/>
                    身型資料設定
                  </h3>
                  <button onClick={() => setIsEditingStats(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-4">
                        {Object.keys(bodyStats).map((key) => {
                            if (key === 'description') return null;
                            const labelMap: Record<string, string> = {
                                height: '身高', weight: '體重', shoulder: '肩寬', chest: '胸圍', 
                                waist: '腰圍', lowWaist: '低腰圍', hips: '臀圍', 
                                pantsLength: '褲長', thigh: '大腿圍', calf: '小腿圍'
                            };
                            return (
                                <div key={key}>
                                    <label className="block text-xs font-medium text-slate-500 mb-1 capitalize">{labelMap[key] || key} (cm/kg)</label>
                                    <input 
                                        type="text" 
                                        value={bodyStats[key as keyof BodyStats]}
                                        onChange={e => setBodyStats({...bodyStats, [key]: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                            )
                        })}
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">體格描述 (AI 參考用)</label>
                        <textarea 
                            value={bodyStats.description}
                            onChange={e => setBodyStats({...bodyStats, description: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            rows={2}
                        />
                    </div>
                </div>
                <div className="p-4 border-t bg-slate-50 flex justify-end">
                    <button 
                        onClick={() => setIsEditingStats(false)}
                        className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                        儲存設定
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Add Item Modal */}
      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-800">新增服飾</h3>
              <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="relative group cursor-pointer shrink-0">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-colors ${newItemImage ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50'}`}>
                  {newItemImage ? (
                    <img src={newItemImage} alt="Preview" className="w-full h-full object-contain p-2" />
                  ) : (
                    <>
                      <Camera className="w-8 h-8 text-slate-400 mb-2" />
                      <span className="text-sm text-slate-500">點擊上傳圖片</span>
                      <span className="text-xs text-slate-400 mt-1">建議使用去背圖片</span>
                    </>
                  )}
                </div>
              </div>

              {newItemImage && (
                  <button
                    onClick={handleAutoTag}
                    disabled={isAutoTagging}
                    className="w-full py-2 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-70 shrink-0"
                  >
                    {isAutoTagging ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            AI 辨識中...
                        </>
                    ) : (
                        <>
                            <Sparkles size={16} />
                            AI 自動辨識名稱與分類
                        </>
                    )}
                  </button>
              )}

              <div className="shrink-0">
                <label className="block text-xs font-medium text-slate-700 mb-1">名稱</label>
                <input 
                  type="text" 
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="例如：白色T恤"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="shrink-0">
                <label className="block text-xs font-medium text-slate-700 mb-1">分類</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setNewItemCategory(cat)}
                      className={`py-2 px-1 text-xs rounded-lg border transition-all ${
                        newItemCategory === cat 
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium' 
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {cat === 'top' ? '上身' : 
                       cat === 'bottom' ? '下身' :
                       cat === 'outerwear' ? '外套' :
                       cat === 'shoes' ? '鞋子' : '配件'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t bg-slate-50 flex justify-end gap-2 shrink-0">
              <button 
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={addItemToWardrobe}
                disabled={!newItemName || !newItemImage}
                className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                新增至衣櫃
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;