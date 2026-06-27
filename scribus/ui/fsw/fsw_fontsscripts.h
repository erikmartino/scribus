/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#ifndef FSW_FONTSSCRIPTS_H
#define FSW_FONTSSCRIPTS_H

#include <QWizardPage>
#include <QStringList>
#include "ui_fsw_fontsscripts.h"

//! \brief Additional font folders and scripter script folders.
class FSW_FontsScripts : public QWizardPage, Ui::FSW_FontsScripts
{
		Q_OBJECT

	public:
		explicit FSW_FontsScripts(QWidget* parent = nullptr);

		QStringList fontPaths() const;
		QStringList scriptPaths() const;

	protected:
		void changeEvent(QEvent* e) override;

	private slots:
		void addFontFolder();
		void removeFontFolder();
		void addScriptFolder();
		void removeScriptFolder();

	private:
		static QStringList pathsFromList(const QListWidget* list);
};
#endif // FSW_FONTSSCRIPTS_H
