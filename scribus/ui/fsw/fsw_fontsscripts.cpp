/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#include "fsw_fontsscripts.h"
#include <QEvent>
#include <QFileDialog>
#include <QListWidget>

FSW_FontsScripts::FSW_FontsScripts(QWidget* parent)
	: QWizardPage(parent)
{
	setupUi(this);
	connect(addFontButton,     &QPushButton::clicked, this, &FSW_FontsScripts::addFontFolder);
	connect(removeFontButton,  &QPushButton::clicked, this, &FSW_FontsScripts::removeFontFolder);
	connect(addScriptButton,   &QPushButton::clicked, this, &FSW_FontsScripts::addScriptFolder);
	connect(removeScriptButton,&QPushButton::clicked, this, &FSW_FontsScripts::removeScriptFolder);
}

void FSW_FontsScripts::addFontFolder()
{
	const QString dir = QFileDialog::getExistingDirectory(this, tr("Select a font folder"));
	if (!dir.isEmpty())
		fontList->addItem(dir);
}

void FSW_FontsScripts::removeFontFolder()
{
	qDeleteAll(fontList->selectedItems());
}

void FSW_FontsScripts::addScriptFolder()
{
	const QString dir = QFileDialog::getExistingDirectory(this, tr("Select a script folder"));
	if (!dir.isEmpty())
		scriptList->addItem(dir);
}

void FSW_FontsScripts::removeScriptFolder()
{
	qDeleteAll(scriptList->selectedItems());
}

QStringList FSW_FontsScripts::pathsFromList(const QListWidget* list)
{
	QStringList out;
	for (int i = 0; i < list->count(); ++i)
		out << list->item(i)->text();
	return out;
}

QStringList FSW_FontsScripts::fontPaths() const
{
	return pathsFromList(fontList);
}

QStringList FSW_FontsScripts::scriptPaths() const
{
	return pathsFromList(scriptList);
}

void FSW_FontsScripts::changeEvent(QEvent* e)
{
	if (e->type() == QEvent::LanguageChange)
		retranslateUi(this);
	QWizardPage::changeEvent(e);
}
