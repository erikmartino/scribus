/*
Copyright (C) 2011 Elvis Stansvik <elvstone@gmail.com>

For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#ifndef SMCELLSTYLEWIDGET_H
#define SMCELLSTYLEWIDGET_H

#include <QWidget>

#include "ui_smcellstylewidget.h"
#include "styles/cellstyle.h"
#include "tableborder.h"
#include "tablesideselector.h"

/**
 * Widget for editing cell style attributes.
 *
 * NOTE: Many attributes unsupported.
 */
class SMCellStyleWidget : public QWidget, public Ui::SMCellStyleWidget
{
		Q_OBJECT

	public:
		/// Constructor.
		SMCellStyleWidget(QWidget* parent = nullptr);
		/// Destructor.
		~SMCellStyleWidget() = default;

		void setDoc(ScribusDoc* doc);

		/**
		 * Shows attributes for a single cell style.
		 *
		 * @param cellStyle cell style for which attributes should be shown.
		 * @param cellStyles list of all cell styles.
		 * @param defaultLanguage default language.
		 * @param unitIndex index of currently used unit.
		 */
		void show(CellStyle *cellStyle, QList<CellStyle> &cellStyles, const QString &defaultLanguage, int unitIndex);

		/**
		 * Shows attributes for multiple cell styles.
		 *
		 * TODO: Implement actual support for multiple styles.
		 *
		 * @param cellStyles list of cell styles for which attributes should be shown.
		 * @param cellStylesAll list of all cell styles.
		 * @param defaultLanguage default language.
		 * @param unitIndex index of currently used unit.
		 */
		void show(QList<CellStyle*> &cellStyles, QList<CellStyle> &cellStylesAll, const QString &defaultLanguage, int unitIndex);

		/**
		 * This function is called when the language is changed.
		 */
		void languageChange();
		void showColors(const QList<CellStyle*> &cellStyles);
		void setBorders(const TableBorder& left, const TableBorder& right, const TableBorder& top, const TableBorder& bottom);

	signals:
		// Emitted when the user changes the border on one or more sides.
		void bordersChanged(TableSides sides, const TableBorder& border);

	protected:
		void changeEvent(QEvent *e) override;

	private:
		enum State { Unset, Set, TriState };

		ScribusDoc * m_Doc {nullptr};
		double m_unitRatio {1.0};
		int m_unitIndex {SC_PT};

		// Border-list state (mirrors the PP version, simplified for SM).
		TableBorder m_currentBorder;
		TableSides m_lastSelection { TableSide::All };

		// Per-side state, set via setBorders, read by the slots.
		TableBorder m_leftBorder;
		TableBorder m_rightBorder;
		TableBorder m_topBorder;
		TableBorder m_bottomBorder;

		void updateBorderLineList();
		void updateBorderLineListItem();
		void mirrorCurrentBorderToSelectedSides();
		QColor getColor(const QString& colorName, int shade) const;

	private slots:
		void handleUpdateRequest(int);
		void iconSetChange();
		void on_sideSelector_selectionChanged();
		void on_borderLineList_currentRowChanged(int row);
		void on_addBorderLineButton_clicked();
		void on_removeBorderLineButton_clicked();
		void on_borderLineWidth_valueChanged(double width);
		void borderLineColorChanged();
		void on_borderLineStyle_activated(int style);
};

#endif // SMCELLSTYLEWIDGET_H
