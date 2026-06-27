/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#ifndef FSW_WELCOME_H
#define FSW_WELCOME_H

#include <QWizardPage>
#include "ui_fsw_welcome.h"

//! \brief Welcome page: splash image, no inputs.
class FSW_Welcome : public QWizardPage, Ui::FSW_Welcome
{
		Q_OBJECT
	public:
		explicit FSW_Welcome(QWidget* parent = nullptr);
		void setThemeMode(int mode);

	protected:
		void changeEvent(QEvent* e) override;

	private:
		void loadSplash();
		int m_mode { 2 };   // 0 light, 1 dark, 2 automatic (default)
};
#endif // FSW_WELCOME_H
