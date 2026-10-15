import { LOCALES, setLocale, useLocale, useT, type LocaleId } from "../i18n";
import { Choices } from "./ui";

/** Settings → Appearance: the language of the interface (every language in `i18n/LOCALES`). */
export function LanguagePicker() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2" data-testid="language-picker">
      <span className="muted text-[12px]">{t("app.languageAbout")}</span>
      <Choices name="language" value={locale} onChange={(v: LocaleId) => setLocale(v)} columns={4} options={LOCALES.map((l) => ({ value: l.id, label: l.label }))} />
    </div>
  );
}
