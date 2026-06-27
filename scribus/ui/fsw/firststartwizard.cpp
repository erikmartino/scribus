/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#include <QDir>

#include "firststartwizard.h"

#include "fsw_sidepanel.h"
#include "fsw_welcome.h"
#include "fsw_language.h"
#include "fsw_appearance.h"
#include "fsw_newdocument.h"
#include "fsw_fontsscripts.h"
#include "fsw_experimental.h"
#include "fsw_finish.h"

#include "prefscontext.h"
#include "prefsfile.h"
#include "prefsmanager.h"
#include "prefsstructs.h"
#include "prefstable.h"

FirstStartWizard::FirstStartWizard(QWidget* parent)
	: QWizard(parent)
{
	setObjectName(QString::fromUtf8("FirstStartWizard"));
	setWizardStyle(QWizard::ModernStyle);
	setWindowTitle(tr("Welcome to Scribus"));
	setMinimumSize(720, 520);

	setOption(QWizard::NoBackButtonOnStartPage, true);
	setOption(QWizard::NoCancelButton, true);
	setOption(QWizard::HaveCustomButton1, true);
	setButtonText(QWizard::CustomButton1, tr("Skip setup"));
	setButtonLayout({ QWizard::CustomButton1, QWizard::Stretch,
					  QWizard::BackButton, QWizard::NextButton, QWizard::FinishButton });

	// Slim branded side panel (logo + step list). The full splash banner lives in
	// the body of the Welcome and Finish pages, not here.
	m_side = new FSW_SidePanel(this);
	setSideWidget(m_side);

	m_welcome      = new FSW_Welcome(this);
	m_language     = new FSW_Language(this);
	m_appearance   = new FSW_Appearance(this);
	m_newDocument  = new FSW_NewDocument(this);
	m_fontsScripts = new FSW_FontsScripts(this);
	m_experimental = new FSW_Experimental(this);
	m_finish       = new FSW_Finish(this);

	setPage(Page_Welcome,      m_welcome);
	setPage(Page_Language,     m_language);
	setPage(Page_Appearance,   m_appearance);
	setPage(Page_NewDocument,  m_newDocument);
	setPage(Page_FontsScripts, m_fontsScripts);
	setPage(Page_Experimental, m_experimental);
	setPage(Page_Finish,       m_finish);

	connect(this, &QWizard::customButtonClicked, this, [this](int which) {
		if (which == QWizard::CustomButton1)
			onSkip();
	});
	connect(this, &QWizard::currentIdChanged, this, &FirstStartWizard::onPageChanged);
	connect(m_appearance, &FSW_Appearance::themeModeChanged, this, &FirstStartWizard::onThemeModeChanged);
}

void FirstStartWizard::onPageChanged(int id)
{
	if (m_side)
		m_side->setCurrentStep(id);
}

void FirstStartWizard::onThemeModeChanged(int mode)
{
	// Live-preview the splash on the banner pages as the user picks a theme (0 light,
	// 1 dark, 2 automatic). Automatic resolves via IconManager's iconsForDarkMode().
	m_welcome->setThemeMode(mode);
	m_finish->setThemeMode(mode);
}

void FirstStartWizard::accept()
{
	applyToPrefs();
	markSetupComplete();
	QWizard::accept();
}

void FirstStartWizard::onSkip()
{
	// Defaults already sit in appPrefs from PrefsManager::initDefaults(); just record
	// that setup ran so the wizard never reappears. Nothing is read from the pages.
	markSetupComplete();
	QWizard::reject();
}

void FirstStartWizard::applyToPrefs()
{
	ApplicationPrefs& p = PrefsManager::instance().appPrefs;

	// --- Language (FSW_Language) ---
	p.uiPrefs.language           = m_language->uiLanguage();        // priAbbrev
	p.docSetupPrefs.language     = m_language->documentLanguage();  // normalised short abbrev
	p.docSetupPrefs.docUnitIndex = m_language->unitIndex();

	// --- Appearance (FSW_Appearance) ---
	switch (m_appearance->themeMode())
	{
		case 0:
			p.uiPrefs.stylePalette = QString::fromUtf8("light");
			break;
		case 1:
			p.uiPrefs.stylePalette = QString::fromUtf8("dark");
			break;
		default:
			p.uiPrefs.stylePalette = QString::fromUtf8("auto");
			break;
	}

	// --- New document defaults (FSW_NewDocument) ---
	p.docSetupPrefs.pageSize = m_newDocument->pageSizeName();
	p.docSetupPrefs.isRTL    = m_newDocument->isRTL();

	// --- Scripts (FSW_FontsScripts) ---
	// pathPrefs.scripts is a SINGLE directory (the Paths pane uses one line edit), not
	// a list — so only the first script entry is meaningful. The FSW scripts control
	// should really be a single line edit rather than an add/remove list.
	const QStringList scriptDirs = m_fontsScripts->scriptPaths();
	if (!scriptDirs.isEmpty())
		p.pathPrefs.scripts = scriptDirs.first();

	// --- Additional font folders (FSW_FontsScripts) ---
	// Font search paths are NOT an appPrefs field; they live in the PrefsFile "Fonts"
	// context, table "ExtraFontDirs" (see Prefs_Fonts::writePaths). Append the wizard's
	// folders there so font initialisation picks them up.
	const QStringList fontDirs = m_fontsScripts->fontPaths();
	if (!fontDirs.isEmpty())
	{
		PrefsContext* fontCtx = PrefsManager::instance().prefsFile->getContext("Fonts");
		PrefsTable* fontTable = fontCtx->getTable("ExtraFontDirs");
		int base = fontTable->getRowCount();
		for (int i = 0; i < fontDirs.size(); ++i)
			fontTable->set(base + i, 0, QDir::fromNativeSeparators(fontDirs.at(i)));
	}
	// NOTE: these are read by font initialisation on next launch. Loading them into the
	// *current* session additionally needs an SCFonts rescan (addScalableFonts +
	// updateFontMap + writeFontCache, as Prefs_Fonts::AddPath does) — left out to avoid
	// a heavy rescan mid-wizard.

	// --- Experimental (FSW_Experimental) ---
	// The only experimental feature today is Notes (the prefs pane labels it
	// "Enable Notes"), so the master toggle maps there. If more land later, this
	// is where they'd be fanned out.
	p.experimentalFeaturePrefs.notesEnabled = m_experimental->experimentalEnabled();

	PrefsManager::instance().savePrefs();
}

void FirstStartWizard::markSetupComplete()
{
	// Record that first-run setup has happened so the wizard never shows again. The
	// read default for this attribute is "0", so once it is written false here, and on
	// every subsequent launch, the wizard stays dormant. Called from both accept() and
	// onSkip(), so finishing or skipping both count as "done".
	PrefsManager::instance().appPrefs.uiPrefs.showFirstStartWizard = false;
	PrefsManager::instance().savePrefs();
}

bool FirstStartWizard::isFirstRun()
{
	// A fresh profile has no prefs file, so initDefaults() leaves showFirstStartWizard
	// true; an existing profile read it (defaulting to "0" when the attribute is
	// absent). Either way this flag is the single source of truth.
	return PrefsManager::instance().appPrefs.uiPrefs.showFirstStartWizard;
}
