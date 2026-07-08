import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, X, Rocket, AppWindow, Keyboard, Sparkles, Info, Check, Globe, Wrench, Bot, Smartphone } from 'lucide-react';
import { useI18n, LANGS, LANG_LABELS } from '../lib/i18n.js';
import { sfx } from '../lib/sound.js';

/**
 * HelpMenu — full multilingual help & guide overlay. Sections cover getting
 * started, window/tab management, keyboard shortcuts, features and about.
 * Includes its own language switcher so users can read the guide in any of the
 * four supported languages.
 */
export default function HelpMenu({ onClose }) {
  const { t, lang, setLang } = useI18n();
  const [section, setSection] = useState('start');

  const SECTIONS = [
    ['start', Rocket, 'help.sec.start'],
    ['windows', AppWindow, 'help.sec.windows'],
    ['shortcuts', Keyboard, 'help.sec.shortcuts'],
    ['diagnostics', Wrench, 'help.sec.diagnostics'],
    ['ai', Bot, 'help.sec.ai'],
    ['mobile', Smartphone, 'help.sec.mobile'],
    ['features', Sparkles, 'help.sec.features'],
    ['about', Info, 'help.sec.about'],
  ];

  const Item = ({ children }) => (
    <li className="flex items-start gap-2.5 leading-relaxed">
      <Check className="w-4 h-4 mt-0.5 shrink-0 text-theme" />
      <span style={{ color: 'var(--text)' }}>{children}</span>
    </li>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10005] grid place-items-center p-4" style={{ background: 'rgba(2,3,8,0.74)', backdropFilter: 'blur(5px)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        className="glass clip-cyber w-full max-w-3xl flex flex-col" style={{ maxHeight: '86vh' }} onClick={(e) => e.stopPropagation()}>

        {/* header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)' }}>
          <HelpCircle className="w-5 h-5 text-theme" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold tracking-cyber text-theme leading-tight">{t('help.title')}</h2>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-dim)' }}>{t('help.subtitle')}</p>
          </div>
          {/* language switcher */}
          <div className="flex items-center gap-1 mr-1">
            <Globe className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} />
            {LANGS.map((l) => (
              <button key={l} onClick={() => { sfx.click(); setLang(l); }}
                className="px-2 py-1 rounded text-[11px] font-display tracking-cyber transition-colors"
                title={LANG_LABELS[l]}
                style={{
                  background: lang === l ? 'color-mix(in srgb, var(--cyber-primary) 18%, transparent)' : 'transparent',
                  color: lang === l ? 'var(--cyber-primary)' : 'var(--text-dim)',
                }}>{l.toUpperCase()}</button>
            ))}
          </div>
          <button onClick={onClose} title={t('help.close')} className="p-1 rounded hover:bg-theme-soft"><X className="w-5 h-5" style={{ color: 'var(--text-dim)' }} /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* section nav */}
          <nav className="w-44 shrink-0 border-r p-2 space-y-1 overflow-y-auto" style={{ borderColor: 'color-mix(in srgb, var(--cyber-primary) 12%, transparent)' }}>
            {SECTIONS.map(([id, Icon, key]) => (
              <button key={id} onClick={() => { sfx.click(); setSection(id); }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] text-left transition-colors"
                style={{
                  background: section === id ? 'color-mix(in srgb, var(--cyber-primary) 14%, transparent)' : 'transparent',
                  color: section === id ? 'var(--cyber-primary)' : 'var(--text)',
                }}>
                <Icon className="w-4 h-4 shrink-0" /> {t(key)}
              </button>
            ))}
          </nav>

          {/* section body */}
          <div className="flex-1 min-w-0 p-5 overflow-y-auto text-[13px]">
            {section === 'start' && (
              <ul className="space-y-3">
                <Item>{t('help.start.1')}</Item>
                <Item>{t('help.start.2')}</Item>
                <Item>{t('help.start.3')}</Item>
                <Item>{t('help.start.4')}</Item>
              </ul>
            )}
            {section === 'windows' && (
              <ul className="space-y-3">
                <Item>{t('help.windows.1')}</Item>
                <Item>{t('help.windows.2')}</Item>
                <Item>{t('help.windows.3')}</Item>
                <Item>{t('help.windows.4')}</Item>
                <Item>{t('help.windows.5')}</Item>
                <Item>{t('help.windows.6')}</Item>
                <Item>{t('help.windows.7')}</Item>
              </ul>
            )}
            {section === 'shortcuts' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <kbd className="px-2 py-1 rounded border border-theme font-mono text-[12px] text-theme-soft">Ctrl + Alt + ← / →</kbd>
                  <span style={{ color: 'var(--text)' }}>{t('help.sc.newtab')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <kbd className="px-2 py-1 rounded border border-theme font-mono text-[12px] text-theme-soft">Ctrl + Alt + S</kbd>
                  <span style={{ color: 'var(--text)' }}>{t('help.sc.split')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <kbd className="px-2 py-1 rounded border border-theme font-mono text-[12px] text-theme-soft">Ctrl + Alt + B</kbd>
                  <span style={{ color: 'var(--text)' }}>{t('help.sc.bcast')}</span>
                </div>
                <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>{t('help.sc.note')}</p>
              </div>
            )}
            {section === 'diagnostics' && (
              <ul className="space-y-3">
                <Item>{t('help.diag.1')}</Item>
                <Item>{t('help.diag.2')}</Item>
                <Item>{t('help.diag.3')}</Item>
                <Item>{t('help.diag.4')}</Item>
                <Item>{t('help.diag.5')}</Item>
                <Item>{t('help.diag.6')}</Item>
                <Item>{t('help.diag.7')}</Item>
              </ul>
            )}
            {section === 'ai' && (
              <ul className="space-y-3">
                <Item>{t('help.ai.1')}</Item>
                <Item>{t('help.ai.2')}</Item>
                <Item>{t('help.ai.3')}</Item>
                <Item>{t('help.ai.4')}</Item>
                <Item>{t('help.ai.5')}</Item>
                <Item>{t('help.ai.6')}</Item>
              </ul>
            )}
            {section === 'mobile' && (
              <ul className="space-y-3">
                <Item>{t('help.mobile.1')}</Item>
                <Item>{t('help.mobile.2')}</Item>
                <Item>{t('help.mobile.3')}</Item>
                <Item>{t('help.mobile.4')}</Item>
              </ul>
            )}
            {section === 'features' && (
              <ul className="space-y-3">
                <Item>{t('help.feat.parsers')}</Item>
                <Item>{t('help.feat.ai')}</Item>
                <Item>{t('help.feat.flows')}</Item>
                <Item>{t('help.feat.vault')}</Item>
              </ul>
            )}
            {section === 'about' && (
              <div className="space-y-4">
                <p className="leading-relaxed" style={{ color: 'var(--text)' }}>{t('help.about')}</p>
                <p className="text-[12px] pt-2 border-t" style={{ color: 'var(--text-dim)', borderColor: 'color-mix(in srgb, var(--cyber-primary) 14%, transparent)' }}>{t('help.about.copyright')}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
