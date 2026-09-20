import os
import random
from google import genai
from google.genai import types

class AIService:
    def __init__(self, api_key: str = None):
        # API kalitni muhit o'zgaruvchisidan (Environment Variable) oladi
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY topilmadi! Muhit o'zgaruvchisini sozlang.")
        
        self.client = genai.Client(api_key=self.api_key)

    def generate_comment(self, video_title: str, video_description: str = "") -> str:
        """
        Video nomi va tavsifi bo'yicha tabiiy va samimiy o'zbekcha izoh generatsiya qiladi.
        """
        prompt = f"""
Siz musiqani yaxshi ko'radigan va ijodiy kontentlarni kuzatib boradigan samimiy tomoshabinsiz.
Quyidagi YouTube videosi (yoki Shortsi) uchun 1 ta qisqa va tabiiy o'zbekcha izoh (comment) yozib bering.

Video nomi: {video_title}
Video tavsifi: {video_description[:200] if video_description else "Mavjud emas"}

Qat'iy qoidalar:
1. Izoh juda samimiy, inson yozgandek va qisqa bo'lsin (1 ta cümladan oshmasin).
2. Reklama, havola (link) yoki "kanalimga o'ting" kabi iboralardan MUTLAQO foydalanmang.
3. Spamlarga o'xshab qolmasligi uchun juda ko'p emotikon (emoji) ishlatmang (maksimum 1 ta yoki umuman ishlatmang).
4. FAQAT izoh matnining o'zini qaytaring. Qo'shtirnoqlar yoki ortiqcha izohlarsiz.
        """

        try:
            response = self.client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    max_output_tokens=100
                )
            )
            
            comment = response.text.strip()
            # Agarda javob qo'shtirnoq ichida qaytsa, ularni olib tashlaymiz
            if comment.startswith('"') and comment.endswith('"'):
                comment = comment[1:-1]
            return comment

        except Exception as e:
            print(f"AI izoh yaratishda xatolik: {e}")
            # Xatolik bo'lganda ishlatiladigan zaxira (fallback) samimiy izohlar
            fallback_comments = [
                "Zo'r chiqibdi, omad!",
                "Musiqa juda yoqdi, ijodga baraka!",
                "Klass! Yana shunaqa kontentlarni kutib qolamiz.",
                "Juda chiroyli ishlangan!",
                "Kayfiyatni ko'taradigan video bo'libdi 🔥"
            ]
            return random.choice(fallback_comments)
