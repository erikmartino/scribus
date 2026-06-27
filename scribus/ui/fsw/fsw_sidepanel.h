/*
For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/
#ifndef FSW_SIDEPANEL_H
#define FSW_SIDEPANEL_H

#include <QWidget>
#include <QList>

class QLabel;
class QVBoxLayout;

/*! \brief The slim branded panel shown on the left of every wizard page.
	Holds the logo and a step list that doubles as a progress indicator. */
class FSW_SidePanel : public QWidget
{
		Q_OBJECT

	public:
		explicit FSW_SidePanel(QWidget* parent = nullptr);

		//! \brief Highlight the active step and mark earlier steps done.
		void setCurrentStep(int id);

	protected:
		void changeEvent(QEvent* e) override;   //!< retranslate

	private:
		void buildStepList();
		void retranslate();

		QLabel* m_logo { nullptr };
		QLabel* m_brandName { nullptr };
		QLabel* m_brandSub { nullptr };
		QVBoxLayout* m_stepsLayout { nullptr };
		QList<QLabel*> m_steps;
		int m_current { 0 };
};

#endif // FSW_SIDEPANEL_H
