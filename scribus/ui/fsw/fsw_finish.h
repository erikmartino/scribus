/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#ifndef FSW_FINISH_H
#define FSW_FINISH_H

#include <QWizardPage>
#include "ui_fsw_finish.h"

//! \brief Summary page. The first-run flag is flipped by the wizard on accept().
class FSW_Finish : public QWizardPage, Ui::FSW_Finish
{
		Q_OBJECT

	public:
		explicit FSW_Finish(QWidget* parent = nullptr);
		void setThemeMode(int mode);

	protected:
		void initializePage() override;   //!< fill the summary from the other pages' fields
		void changeEvent(QEvent* e) override;

	private:
		void loadSplash();
		int m_mode { 2 };   // 0 light, 1 dark, 2 automatic (default)
};
#endif // FSW_FINISH_H
