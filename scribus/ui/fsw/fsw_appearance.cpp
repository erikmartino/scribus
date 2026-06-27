/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#include "fsw_appearance.h"
#include <QEvent>
#include <QRadioButton>

FSW_Appearance::FSW_Appearance(QWidget* parent)
	: QWizardPage(parent)
{
	setupUi(this);
	themeAutoRadio->setChecked(true);
	workspaceFullRadio->setChecked(true);
	wireRadios();
}

void FSW_Appearance::wireRadios()
{
	connect(themeLightRadio, &QRadioButton::toggled, this, [this](bool on){ if (on) emit themeModeChanged(0); });
	connect(themeDarkRadio,  &QRadioButton::toggled, this, [this](bool on){ if (on) emit themeModeChanged(1); });
	connect(themeAutoRadio,  &QRadioButton::toggled, this, [this](bool on){ if (on) emit themeModeChanged(2); });
}

int FSW_Appearance::themeMode() const
{
	if (themeLightRadio->isChecked())
		return 0;
	if (themeDarkRadio->isChecked())
		return 1;
	return 2;
}

bool FSW_Appearance::minimalWorkspace() const
{
	// TODO: "minimal" needs a defined preset (which toolbars/docks to hide).
	return workspaceMinimalRadio->isChecked();
}

void FSW_Appearance::changeEvent(QEvent* e)
{
	if (e->type() == QEvent::LanguageChange)
		retranslateUi(this);
	QWizardPage::changeEvent(e);
}
