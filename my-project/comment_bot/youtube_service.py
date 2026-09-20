import os
import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# YouTube API uchun talab qilinadigan huquqlar (ruxsatlar)
SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl']

class YouTubeService:
    def __init__(self, client_secret_file: str = "client_secret.json", token_file: str = "token.json"):
        # Fayl yo'llarini to'g'ri ko'rsatish
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.client_secret_file = os.path.join(base_dir, client_secret_file)
        self.token_file = os.path.join(base_dir, token_file)
        self.creds = None
        self._authenticate()
        self.youtube = build('youtube', 'v3', credentials=self.creds)

    def _authenticate(self):
        """Google OAuth 2.0 orqali avtorizatsiyadan o'tish (Fly.io Secret va lokal fayllarni qo'llab-quvvatlaydi)"""
        
        # 1. Fly.io Secrets'da CLIENT_SECRET_JSON bo'lsa va fayl hali yo'q bo me, uni avtomatik yaratib oladi
        env_secret = os.environ.get("CLIENT_SECRET_JSON")
        if env_secret and not os.path.exists(self.client_secret_file):
            with open(self.client_secret_file, "w") as f:
                f.write(env_secret)

        # 2. Token mavjud bo'lsa yuklaymiz
        if os.path.exists(self.token_file):
            self.creds = Credentials.from_authorized_user_file(self.token_file, SCOPES)
        
        # 3. Token mavjud bo'lmasa yoki muddati o'tgan bo'lsa
        if not self.creds or not self.creds.valid:
            if self.creds and self.creds.expired and self.creds.refresh_token:
                self.creds.refresh(Request())
            else:
                if not os.path.exists(self.client_secret_file):
                    raise FileNotFoundError(
                        f"OAuth fayli topilmadi: {self.client_secret_file}. "
                        "Fly.io Secrets orqali CLIENT_SECRET_JSON o'rnatilganini yoki fayl papkada borligini tekshiring."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.client_secret_file, SCOPES)
                self.creds = flow.run_local_server(port=0)
            
            # Keyingi safar ishlatish uchun tokenni saqlaymiz
            with open(self.token_file, 'w') as token:
                token.write(self.creds.to_json())

    def get_recent_popular_videos(self, max_results: int = 15):
        """
        O'zbekiston auditoriyasiga oid yangi chiqqan yoki mashhur musiqiy video va Shortslarni topadi.
        """
        try:
            request = self.youtube.search().list(
                part="snippet",
                q="musiqa OR uzbek music OR shorts OR premiera",
                regionCode="UZ",
                relevanceLanguage="uz",
                type="video",
                order="date",  # Eng yangi videolarni olish uchun
                maxResults=max_results
            )
            response = request.execute()

            videos = []
            for item in response.get('items', []):
                video_id = item['id']['videoId']
                title = item['snippet']['title']
                description = item['snippet']['description']
                channel_title = item['snippet']['channelTitle']
                
                videos.append({
                    'id': video_id,
                    'title': title,
                    'description': description,
                    'channel_title': channel_title
                })

            return videos

        except HttpError as e:
            print(f"YouTube API qidiruvida xatolik yuz berdi: {e}")
            return []

    def leave_comment(self, video_id: str, comment_text: str) -> bool:
        """
        Tanlangan videoga tayyorlangan izohni qoldiradi.
        """
        try:
            body = {
                'snippet': {
                    'videoId': video_id,
                    'topLevelComment': {
                        'snippet': {
                            'textOriginal': comment_text
                        }
                    }
                }
            }
            request = self.youtube.commentThreads().insert(
                part="snippet",
                body=body
            )
            request.execute()
            print(f"[SUCCESS] Izoh muvaffaqiyatli joylandi! (Video ID: {video_id})")
            return True

        except HttpError as e:
            print(f"[ERROR] Izoh joylashda xatolik yuz berdi: {e}")
            return False
