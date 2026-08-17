import React from 'react';
import {
  ChevronRight,
  ListChecks,
  LogIn,
  LogOut,
  Sliders,
  Terminal,
  X,
} from 'lucide-react';
import { BeatriceConfig, VOICE_NAMES, voiceAlias, VoiceName } from '../types';
import { VadConfig, VadStatus } from '../lib/audioUtils';
import { VadControlWidget } from './VadControlWidget';
import { WhatsAppLinkCard, WhatsAppPanelState } from './WhatsAppPanel';
import { useAuth } from '../context/AuthContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BeatriceConfig;
  onSaveConfig: (newConfig: Partial<BeatriceConfig>) => void;
  vadConfig?: VadConfig;
  vadStatus?: VadStatus;
  onSaveVadConfig?: (newConfig: Partial<VadConfig>) => void;
  onOpenProfile?: () => void;
  onOpenTasker?: () => void;
  onOpenTerminal?: () => void;
  waStatus?: WhatsAppPanelState;
  onPairWhatsApp?: (phone: string) => void;
  onQrPairWhatsApp?: () => void;
  onCancelWhatsAppPairing?: () => void;
  onLogoutWhatsApp?: () => void;
  onResetWhatsApp?: () => void;
  onToggleWhatsAppBossMode?: (enabled: boolean) => void;
}

const Toggle: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-11 h-[26px] rounded-full p-[2px] transition-colors cursor-pointer ${
      on ? 'bg-[#00f2fe]' : 'bg-white/15'
    }`}
  >
    <div
      className={`w-[22px] h-[22px] rounded-full bg-white shadow-md transition-transform ${
        on ? 'translate-x-[18px]' : ''
      }`}
    />
  </button>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] uppercase tracking-widest text-[#8e8e93] font-mono px-1">
    {children}
  </div>
);

const GroupRow: React.FC<{
  label: string;
  right?: React.ReactNode;
  onClick?: () => void;
  red?: boolean;
  disabled?: boolean;
}> = ({ label, right, onClick, red, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-xs text-left transition-colors ${
      onClick ? 'active:bg-white/[0.06] cursor-pointer' : 'cursor-default'
    } ${red ? 'text-rose-400 font-semibold' : 'text-white'}`}
  >
    <span className="truncate">{label}</span>
    {right && <span className="flex items-center gap-1 shrink-0">{right}</span>}
  </button>
);

const RowSelect: React.FC<{
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none bg-transparent text-[#00f2fe] text-xs font-medium pr-4 text-right focus:outline-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#0a0a0c] text-white">
          {o.label}
        </option>
      ))}
    </select>
    <ChevronRight className="w-3.5 h-3.5 text-[#8e8e93] absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
  </div>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  vadConfig,
  vadStatus,
  onSaveVadConfig,
  onOpenProfile,
  onOpenTasker,
  onOpenTerminal,
  waStatus,
  onPairWhatsApp,
  onQrPairWhatsApp,
  onCancelWhatsAppPairing,
  onLogoutWhatsApp,
  onResetWhatsApp,
  onToggleWhatsAppBossMode,
}) => {
  const { user, signInWithGoogle, logout } = useAuth();

  if (!isOpen) return null;

  const voices = VOICE_NAMES;
  const languages = [
    { value: 'auto', label: 'Auto' },
    { value: 'nl-BE', label: 'Vlaams' },
    { value: 'ab', label: 'Аҧсуа' },
    { value: 'ace', label: 'Aceh' },
    { value: 'ach', label: 'Acoli' },
    { value: 'aa', label: 'Afaraf' },
    { value: 'af', label: 'Afrikaans' },
    { value: 'sq', label: 'Shqip' },
    { value: 'alz', label: 'Alur' },
    { value: 'am', label: 'አማርኛ' },
    { value: 'ar', label: 'العربية' },
    { value: 'hy', label: 'Հայերեն' },
    { value: 'as', label: 'অসমীয়া' },
    { value: 'av', label: 'Авар' },
    { value: 'awa', label: 'अवधी' },
    { value: 'ay', label: 'Aymar aru' },
    { value: 'az', label: 'Azərbaycan' },
    { value: 'ban', label: 'Basa Bali' },
    { value: 'bal', label: 'بلوچی' },
    { value: 'bm', label: 'Bamanankan' },
    { value: 'bci', label: 'Baoulé' },
    { value: 'ba', label: 'Башҡорт' },
    { value: 'eu', label: 'Euskara' },
    { value: 'btx', label: 'Karo' },
    { value: 'bts', label: 'Simalungun' },
    { value: 'bbc', label: 'Toba' },
    { value: 'be', label: 'Беларуская' },
    { value: 'bem', label: 'Bemba' },
    { value: 'bn', label: 'বাংলা' },
    { value: 'bew', label: 'Betawi' },
    { value: 'bho', label: 'भोजपुरी' },
    { value: 'bik', label: 'Bikol' },
    { value: 'bs', label: 'Bosanski' },
    { value: 'br', label: 'Brezhoneg' },
    { value: 'bg', label: 'Български' },
    { value: 'bua', label: 'Буряад' },
    { value: 'yue', label: '粵語' },
    { value: 'ca', label: 'Català' },
    { value: 'ceb', label: 'Cebuano' },
    { value: 'ch', label: 'Chamoru' },
    { value: 'ce', label: 'Нохчийн' },
    { value: 'ny', label: 'Chichewa' },
    { value: 'zh-CN', label: '中文 (简体)' },
    { value: 'zh-TW', label: '中文 (繁體)' },
    { value: 'chk', label: 'Chuukese' },
    { value: 'cv', label: 'Чӑваш' },
    { value: 'co', label: 'Corsu' },
    { value: 'crh-Cyrl', label: 'Къырымтатарджа' },
    { value: 'crh-Latn', label: 'Qırımtatarca' },
    { value: 'hr', label: 'Hrvatski' },
    { value: 'cs', label: 'Čeština' },
    { value: 'da', label: 'Dansk' },
    { value: 'prs', label: 'دری' },
    { value: 'dv', label: 'ދިވެހި' },
    { value: 'din', label: 'Thuɔŋjäŋ' },
    { value: 'doi', label: 'डोगरी' },
    { value: 'dov', label: 'Dombe' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'dyu', label: 'Julakan' },
    { value: 'dz', label: 'རྫོང་ཁ' },
    { value: 'en', label: 'English' },
    { value: 'eo', label: 'Esperanto' },
    { value: 'et', label: 'Eesti' },
    { value: 'ee', label: 'Eʋegbe' },
    { value: 'fo', label: 'Føroyskt' },
    { value: 'fj', label: 'Vosa Vakaviti' },
    { value: 'tl', label: 'Filipino' },
    { value: 'fi', label: 'Suomi' },
    { value: 'fon', label: 'Fon' },
    { value: 'fr', label: 'Français' },
    { value: 'fr-CA', label: 'Français (Canada)' },
    { value: 'fy', label: 'Frysk' },
    { value: 'fur', label: 'Furlan' },
    { value: 'ff', label: 'Fulfulde' },
    { value: 'gaa', label: 'Ga' },
    { value: 'gl', label: 'Galego' },
    { value: 'ka', label: 'ქართული' },
    { value: 'de', label: 'Deutsch' },
    { value: 'el', label: 'Ελληνικά' },
    { value: 'gn', label: 'Guarani' },
    { value: 'gu', label: 'ગુજરાતી' },
    { value: 'ht', label: 'Kreyòl Ayisyen' },
    { value: 'cnh', label: 'Hakha Chin' },
    { value: 'ha', label: 'Hausa' },
    { value: 'haw', label: 'ʻŌlelo Hawaiʻi' },
    { value: 'iw', label: 'עברית' },
    { value: 'hil', label: 'Hiligaynon' },
    { value: 'hi', label: 'हिन्दी' },
    { value: 'hmn', label: 'Hmoob' },
    { value: 'hu', label: 'Magyar' },
    { value: 'hrx', label: 'Hunsrik' },
    { value: 'iba', label: 'Iban' },
    { value: 'is', label: 'Íslenska' },
    { value: 'ig', label: 'Igbo' },
    { value: 'ilo', label: 'Iloko' },
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'iu-Latn', label: 'Inuktut' },
    { value: 'iu-Cans', label: 'ᐃᓄᒃᑎᑐᑦ' },
    { value: 'ga', label: 'Gaeilge' },
    { value: 'it', label: 'Italiano' },
    { value: 'jam', label: 'Patois' },
    { value: 'ja', label: '日本語' },
    { value: 'jw', label: 'Basa Jawa' },
    { value: 'kac', label: 'Jinghpaw' },
    { value: 'kl', label: 'Kalaallisut' },
    { value: 'kn', label: 'ಕನ್ನಡ' },
    { value: 'kr', label: 'Kanuri' },
    { value: 'pam', label: 'Kapampangan' },
    { value: 'kk', label: 'Қазақ' },
    { value: 'kha', label: 'Khasi' },
    { value: 'km', label: 'ខ្មែរ' },
    { value: 'cgg', label: 'Kiga' },
    { value: 'kg', label: 'Kikongo' },
    { value: 'rw', label: 'Ikinyarwanda' },
    { value: 'ktu', label: 'Kituba' },
    { value: 'trp', label: 'Kokborok' },
    { value: 'kv', label: 'Коми' },
    { value: 'gom', label: 'कोंकणी' },
    { value: 'ko', label: '한국어' },
    { value: 'kri', label: 'Krio' },
    { value: 'ku', label: 'Kurdî (Kurmancî)' },
    { value: 'ckb', label: 'سۆرانی' },
    { value: 'ky', label: 'Кыргызча' },
    { value: 'lo', label: 'ລາວ' },
    { value: 'ltg', label: 'Latgaļu' },
    { value: 'la', label: 'Latina' },
    { value: 'lv', label: 'Latviešu' },
    { value: 'lij', label: 'Ligure' },
    { value: 'li', label: 'Limburgs' },
    { value: 'ln', label: 'Lingála' },
    { value: 'lt', label: 'Lietuvių' },
    { value: 'lmo', label: 'Lombard' },
    { value: 'lg', label: 'Luganda' },
    { value: 'luo', label: 'Luo' },
    { value: 'lb', label: 'Lëtzebuergesch' },
    { value: 'mk', label: 'Македонски' },
    { value: 'mad', label: 'Madura' },
    { value: 'mai', label: 'मैथिली' },
    { value: 'mak', label: 'Makassar' },
    { value: 'mg', label: 'Malagasy' },
    { value: 'ms', label: 'Bahasa Melayu' },
    { value: 'ms-Arab', label: 'بهاس ملايو' },
    { value: 'ml', label: 'മലയാളം' },
    { value: 'mt', label: 'Malti' },
    { value: 'mam', label: 'Mam' },
    { value: 'gv', label: 'Gaelg' },
    { value: 'mi', label: 'Māori' },
    { value: 'mr', label: 'मराठी' },
    { value: 'mh', label: 'Kajin M̧ajeļ' },
    { value: 'mwr', label: 'मारवाड़ी' },
    { value: 'mfe', label: 'Kreol Morisien' },
    { value: 'mhr', label: 'Марий' },
    { value: 'mni-Mtei', label: 'মৈতৈলোন্' },
    { value: 'min', label: 'Minang' },
    { value: 'lus', label: 'Mizo ṭawng' },
    { value: 'mn', label: 'Монгол' },
    { value: 'my', label: 'မြန်မာ' },
    { value: 'nhe', label: 'Nahuatl' },
    { value: 'ndc', label: 'Ndau' },
    { value: 'nr', label: 'isiNdebele' },
    { value: 'new', label: 'नेपाल भाषा' },
    { value: 'ne', label: 'नेपाली' },
    { value: 'nqo', label: 'ߒߞߏ' },
    { value: 'no', label: 'Norsk' },
    { value: 'nus', label: 'Naath' },
    { value: 'oc', label: 'Occitan' },
    { value: 'or', label: 'ଓଡ଼ିଆ' },
    { value: 'om', label: 'Afaan Oromoo' },
    { value: 'os', label: 'Ирон' },
    { value: 'pag', label: 'Pangasinan' },
    { value: 'pap', label: 'Papiamentu' },
    { value: 'ps', label: 'پښتو' },
    { value: 'fa', label: 'فارسی' },
    { value: 'pl', label: 'Polski' },
    { value: 'pt-BR', label: 'Português (Brasil)' },
    { value: 'pt', label: 'Português (Portugal)' },
    { value: 'pa', label: 'ਪੰਜਾਬੀ' },
    { value: 'pa-Arab', label: 'پنجابی' },
    { value: 'qu', label: 'Runasimi' },
    { value: 'kek', label: 'Qʼeqchiʼ' },
    { value: 'rom', label: 'Romani' },
    { value: 'ro', label: 'Română' },
    { value: 'rn', label: 'Ikirundi' },
    { value: 'ru', label: 'Русский' },
    { value: 'se', label: 'Davvisámegiella' },
    { value: 'sm', label: 'Gagana Samoa' },
    { value: 'sg', label: 'Sängö' },
    { value: 'sa', label: 'संस्कृतम्' },
    { value: 'sat-Latn', label: 'Santali' },
    { value: 'sat-Olck', label: 'ᱥᱟᱱᱛᱟᱲᱤ' },
    { value: 'gd', label: 'Gàidhlig' },
    { value: 'nso', label: 'Sepedi' },
    { value: 'sr', label: 'Српски' },
    { value: 'st', label: 'Sesotho' },
    { value: 'crs', label: 'Seselwa' },
    { value: 'shn', label: 'ၽႃႇသႃႇတႆး' },
    { value: 'sn', label: 'Shona' },
    { value: 'scn', label: 'Sicilianu' },
    { value: 'szl', label: 'Ślůnski' },
    { value: 'sd', label: 'سنڌي' },
    { value: 'si', label: 'සිංහල' },
    { value: 'sk', label: 'Slovenčina' },
    { value: 'sl', label: 'Slovenščina' },
    { value: 'so', label: 'Soomaali' },
    { value: 'es', label: 'Español' },
    { value: 'su', label: 'Basa Sunda' },
    { value: 'sus', label: 'Susu' },
    { value: 'sw', label: 'Kiswahili' },
    { value: 'ss', label: 'SiSwati' },
    { value: 'sv', label: 'Svenska' },
    { value: 'ty', label: 'Reo Tahiti' },
    { value: 'tg', label: 'Тоҷикӣ' },
    { value: 'tzm', label: 'Tamazight' },
    { value: 'tzm-Tfng', label: 'ⵜⴰⵎⴰⵣⵉⵖⵜ' },
    { value: 'ta', label: 'தமிழ்' },
    { value: 'tt', label: 'Татар' },
    { value: 'te', label: 'తెలుగు' },
    { value: 'tet', label: 'Tetun' },
    { value: 'th', label: 'ไทย' },
    { value: 'bo', label: 'བོད་སྐད' },
    { value: 'ti', label: 'ትግርኛ' },
    { value: 'tiv', label: 'Tiv' },
    { value: 'tpi', label: 'Tok Pisin' },
    { value: 'to', label: 'Lea Faka-Tonga' },
    { value: 'lua', label: 'Tshiluba' },
    { value: 'ts', label: 'Xitsonga' },
    { value: 'tn', label: 'Setswana' },
    { value: 'tcy', label: 'ತುಳು' },
    { value: 'tum', label: 'Tumbuka' },
    { value: 'tr', label: 'Türkçe' },
    { value: 'tk', label: 'Türkmen' },
    { value: 'tyv', label: 'Тыва' },
    { value: 'tw', label: 'Twi' },
    { value: 'udm', label: 'Удмурт' },
    { value: 'uk', label: 'Українська' },
    { value: 'ur', label: 'اردو' },
    { value: 'ug', label: 'ئۇيغۇرچە' },
    { value: 'uz', label: 'Oʻzbek' },
    { value: 've', label: 'Tshivenḓa' },
    { value: 'vec', label: 'Vèneto' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'war', label: 'Winaray' },
    { value: 'cy', label: 'Cymraeg' },
    { value: 'wo', label: 'Wolof' },
    { value: 'xh', label: 'isiXhosa' },
    { value: 'sah', label: 'Саха' },
    { value: 'yi', label: 'ייִדיש' },
    { value: 'yo', label: 'Yorùbá' },
    { value: 'yua', label: 'Maya' },
    { value: 'zap', label: 'Zapotec' },
    { value: 'zu', label: 'isiZulu' },
  ];
  const toolToggles: { label: string; on: boolean; onChange: () => void }[] = [
    {
      label: 'Code Sandbox',
      on: config.enableSandboxTool,
      onChange: () => onSaveConfig({ enableSandboxTool: !config.enableSandboxTool }),
    },
    {
      label: 'Terminal CLI',
      on: config.enableCliTool,
      onChange: () => onSaveConfig({ enableCliTool: !config.enableCliTool }),
    },
    {
      label: 'Sub-Agents',
      on: config.enableAgentTool,
      onChange: () => onSaveConfig({ enableAgentTool: !config.enableAgentTool }),
    },
    {
      label: 'Web Search',
      on: config.enableWebSearchTool,
      onChange: () => onSaveConfig({ enableWebSearchTool: !config.enableWebSearchTool }),
    },
  ];

  return (
    <div className="b-modal-overlay">
      <div className="b-modal max-w-lg">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-black/60 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#00f2fe]/10 border border-[#00f2fe]/30 flex items-center justify-center text-[#00f2fe]">
              <Sliders className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-white tracking-wide">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-5 text-xs scrollbar-hide">
          {/* Account */}
          <div className="space-y-1.5">
            <SectionLabel>Account</SectionLabel>
            <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden divide-y divide-white/[0.07]">
              {user ? (
                <>
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="w-full flex items-center gap-3 px-4 py-3 active:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User'}
                        className="w-9 h-9 rounded-full border border-[#00f2fe]/40 object-cover"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[#00f2fe]/20 border border-[#00f2fe]/40 text-[#00f2fe] flex items-center justify-center font-bold">
                        {user.email?.[0].toUpperCase() || 'U'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <div className="font-semibold text-white text-xs truncate">
                        {user.displayName || 'Signed in'}
                      </div>
                      <div className="text-[10px] text-[#8e8e93] truncate font-mono">
                        {user.email}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8e8e93]" />
                  </button>
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full py-3.5 text-center text-xs text-rose-400 font-semibold active:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </span>
                  </button>
                </>
              ) : (
                <GroupRow
                  label="Sign in with Google"
                  red={false}
                  onClick={signInWithGoogle}
                  right={<LogIn className="w-4 h-4 text-[#00f2fe]" />}
                />
              )}
            </div>
          </div>

          {/* Tasker */}
          <div className="space-y-1.5">
            <SectionLabel>Tasker</SectionLabel>
            <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden divide-y divide-white/[0.07]">
              <GroupRow
                label="Task History"
                onClick={onOpenTasker}
                right={
                  <span className="flex items-center gap-1.5">
                    <ListChecks className="w-4 h-4 text-[#00f2fe]" />
                    <ChevronRight className="w-4 h-4 text-[#8e8e93]" />
                  </span>
                }
              />
            </div>
          </div>

          {/* Workstation */}
          {onOpenTerminal && (
            <div className="space-y-1.5">
              <SectionLabel>Workstation</SectionLabel>
              <button
                type="button"
                onClick={onOpenTerminal}
                className="w-full rounded-2xl bg-[#121215] border border-white/10 overflow-hidden active:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                    <Terminal className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-semibold text-white text-xs">Beatrice Work Station</div>
                    <div className="text-[10px] text-[#8e8e93] font-mono uppercase tracking-widest">
                      Open a shell on the server
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#8e8e93]" />
                </div>
              </button>
            </div>
          )}

          {/* Voice & Language */}
          <div className="space-y-1.5">
            <SectionLabel>Voice & Language</SectionLabel>
            <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden divide-y divide-white/[0.07]">
              <GroupRow
                label="Voice"
                right={
                  <RowSelect
                    value={config.voiceName}
                    onChange={(v) => onSaveConfig({ voiceName: v as VoiceName })}
                    options={voices.map((v) => ({ value: v, label: voiceAlias(v) }))}
                  />
                }
              />
              <GroupRow
                label="Language"
                right={
                  <RowSelect
                    value={config.preferredLanguage || 'auto'}
                    onChange={(v) => onSaveConfig({ preferredLanguage: v })}
                    options={languages}
                  />
                }
              />
            </div>
          </div>

          {/* Speech / VAD */}
          {vadConfig && vadStatus && onSaveVadConfig && (
            <div className="space-y-1.5">
              <SectionLabel>Speech</SectionLabel>
              <VadControlWidget
                vadConfig={vadConfig}
                vadStatus={vadStatus}
                onUpdateConfig={onSaveVadConfig}
              />
            </div>
          )}

          {/* WhatsApp */}
          {waStatus && onPairWhatsApp && onQrPairWhatsApp && (
            <div className="space-y-1.5">
              <SectionLabel>WhatsApp</SectionLabel>
              <WhatsAppLinkCard
                status={waStatus}
                onPair={onPairWhatsApp}
                onQr={onQrPairWhatsApp}
                onCancel={onCancelWhatsAppPairing || (() => {})}
                onLogout={onLogoutWhatsApp || (() => {})}
                onReset={onResetWhatsApp || (() => {})}
                onToggleBossMode={onToggleWhatsAppBossMode}
              />
            </div>
          )}

          {/* Video */}
          <div className="space-y-1.5">
            <SectionLabel>Video</SectionLabel>
            <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden divide-y divide-white/[0.07]">
              <div className="px-4 py-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-white text-xs">Frame Rate</span>
                  <span className="text-[#00f2fe] text-xs font-mono">
                    {config.videoFps} FPS
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={1}
                  value={config.videoFps}
                  onChange={(e) => onSaveConfig({ videoFps: Number(e.target.value) })}
                  className="w-full accent-[#00f2fe] cursor-pointer h-1.5"
                />
              </div>
            </div>
          </div>

          {/* Persona */}
          <div className="space-y-1.5">
            <SectionLabel>Persona</SectionLabel>
            <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden">
              <div className="px-4 py-3.5 space-y-2">
                <div className="text-white text-xs">System Prompt</div>
                <textarea
                  value={config.systemInstruction}
                  onChange={(e) => onSaveConfig({ systemInstruction: e.target.value })}
                  rows={3}
                  className="w-full bg-black/60 border border-white/10 focus:border-[#00f2fe]/60 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none resize-none placeholder-zinc-500 font-sans"
                />
              </div>
            </div>
          </div>

          {/* Tools */}
          <div className="space-y-1.5">
            <SectionLabel>Tools</SectionLabel>
            <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden divide-y divide-white/[0.07]">
              {toolToggles.map((t) => (
                <div key={t.label} className="flex items-center justify-between px-4 py-3.5">
                  <span className="text-white text-xs">{t.label}</span>
                  <Toggle on={t.on} onChange={t.onChange} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};