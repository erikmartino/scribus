/*
Copyright (C) 2011 Elvis Stansvik <elvstone@gmail.com>

For general Scribus (>=1.3.2) copyright and licensing information please refer
to the COPYING file provided with the program. Following this notice may exist
a copyright and/or license notice that predates the release of Scribus 1.3.2
for which a new license (GPL+exception) is in place.
*/

#include "colorcombo.h"
#include "iconmanager.h"
#include "sccolorengine.h"
#include "scribus.h"
#include "scribusapp.h"
#include "smtablestylewidget.h"
#include "util.h"
#include "util_color.h"

SMTableStyleWidget::SMTableStyleWidget(QWidget *parent)
                  : QWidget(parent)
{
	setupUi(this);

	sideSelector->setInnerActive(false);
	sideSelector->setStyle(TableSideSelector::TableStyle);

	buttonLineColor->colorButton->setContext(Context::TableCellStroke);
	buttonLineColor->setColor(CommonStrings::tr_NoneColor);
	buttonLineColor->setText(tr("Color"));

	buttonFillColor->colorButton->setContext(Context::TableCellFill);
	buttonFillColor->setColor(CommonStrings::tr_NoneColor);
	buttonFillColor->setText(tr("Color"));

	iconSetChange();

	connect(ScQApp, SIGNAL(iconSetChanged()), this, SLOT(iconSetChange()));
	connect(buttonLineColor->colorButton, &ColorButton::changed, this, &SMTableStyleWidget::borderLineColorChanged);
}

void SMTableStyleWidget::changeEvent(QEvent *e)
{
	if (e->type() == QEvent::LanguageChange)
		languageChange();
	else
		QWidget::changeEvent(e);
}

void SMTableStyleWidget::iconSetChange()
{
	IconManager& iconManager = IconManager::instance();
	addBorderLineButton->setIcon(iconManager.loadIcon("stroke-add"));
	removeBorderLineButton->setIcon(iconManager.loadIcon("stroke-remove"));
	cellStyleClearButton->setIcon(iconManager.loadIcon("reset"));
	buttonFillColor->setPixmap(iconManager.loadPixmap("color-fill"));
	buttonLineColor->setPixmap(iconManager.loadPixmap("color-stroke"));
	labelCellStyle->setPixmap(iconManager.loadPixmap("table-cell-style"));
	labelParagraphStyle->setPixmap(iconManager.loadPixmap("paragraph-style"));
	editingAreaLabel->setPixmap(iconManager.loadPixmap("table-area"));
}

void SMTableStyleWidget::handleUpdateRequest(int updateFlags)
{
	if (!m_Doc)
		return;
	if (updateFlags & reqTextStylesUpdate)
	{
		paragraphStyleComboBox->updateStyleList();
		basedOnComboBox->updateStyleList();
	}
}

void SMTableStyleWidget::setDoc(ScribusDoc* doc)
{
	if (m_Doc)
		disconnect(m_Doc->scMW(), SIGNAL(UpdateRequest(int)), this , SLOT(handleUpdateRequest(int)));

	m_Doc = doc;
	if (!m_Doc)
		return;

	buttonLineColor->colorButton->setDoc(m_Doc);
	buttonFillColor->colorButton->setDoc(m_Doc);
	paragraphStyleComboBox->setDoc(m_Doc);
	basedOnComboBox->setDoc(m_Doc);
	connect(m_Doc->scMW(), SIGNAL(UpdateRequest(int)), this , SLOT(handleUpdateRequest(int)));
}

void SMTableStyleWidget::show(TableStyle *tableStyle, QList<TableStyle> &tableStyles, const QString& /*defLang*/, int /*unitIndex*/)
{
	Q_ASSERT(tableStyle);
	if (!tableStyle)
		return;
	parentCombo->setEnabled(!tableStyle->isDefaultStyle());
	const TableStyle *parent = dynamic_cast<const TableStyle*>(tableStyle->parentStyle());
	bool hasParent = tableStyle->hasParent() && parent != nullptr && parent->hasName() && tableStyle->parent() != "";

	rebuildAreaCombo(tableStyle);
	showFillForCurrentArea(tableStyle);
	showParagraphStyleForCurrentArea(tableStyle);
	showBordersForCurrentArea(tableStyle);
	showBasedOnForCurrentArea(tableStyle);

	int headerRowCount = tableStyle->headerRows();
	int totalRowCount = tableStyle->totalRows();
	setSpin(headerRowsSpinBox, headerRowCount);
	setSpin(totalRowsSpinBox, totalRowCount);
	setCheck(bandedRowsCheckBox, tableStyle->bandedRows());
	setCheck(bandedColumnsCheckBox, tableStyle->bandedColumns());
	setCheck(firstColumnCheckBox, tableStyle->firstColumn());
	setCheck(lastColumnCheckBox, tableStyle->lastColumn());
	setCheck(lastColumnCheckBox, tableStyle->lastColumn());
	setCombo(tableDirectionComboBox, tableStyle->tableRTL() ? 1 : 0);

	parentCombo->clear();
	parentCombo->addItem( tableStyle->isDefaultStyle()? tr("A default style cannot be assigned a parent style") : "");
	if (!tableStyle->isDefaultStyle())
	{
		QStringList styleNames;
		for (int i = 0; i < tableStyles.count(); ++i)
		{
			if (tableStyles[i].name() != tableStyle->name())
				styleNames.append(tableStyles[i].name());
		}
		styleNames.sort(Qt::CaseSensitive);
		parentCombo->addItems(styleNames);
	}

	if (tableStyle->isDefaultStyle() || !hasParent)
	{
		parentCombo->setCurrentIndex(0);
	}
	else if (hasParent)
	{
		int index = parentCombo->findText(tableStyle->parentStyle()->name());
		if (index < 0)
			index = 0;
		parentCombo->setCurrentIndex(index);
	}
}

void SMTableStyleWidget::show(QList<TableStyle*> &tableStyles, QList<TableStyle> &tableStylesAll, const QString &defaultLanguage, int unitIndex)
{
	if (tableStyles.count() == 1)
		show(tableStyles[0], tableStylesAll, defaultLanguage, unitIndex);
	else if (tableStyles.count() > 1)
	{
		showColors(tableStyles);
		parentCombo->setEnabled(false);
	}
}

void SMTableStyleWidget::showColors(const QList<TableStyle*> &tableStyles)
{
	double d = -30000;
	for (int i = 0; i < tableStyles.count(); ++i)
	{
		if (d != -30000 && tableStyles[i]->fillShade() != d)
		{
			d = -30000;
			break;
		}
		d = tableStyles[i]->fillShade();
	}
	QString s;
	for (int i = 0; i < tableStyles.count(); ++i)
	{
		if (!s.isEmpty() && s != tableStyles[i]->fillColor())
		{
			s.clear();
			break;
		}
		s = tableStyles[i]->fillColor();
	}

	buttonFillColor->setColor(s, qRound(d));
}

void SMTableStyleWidget::languageChange()
{
	retranslateUi(this);

	buttonLineColor->colorButton->setPersistentToolTip( tr("Border color of table"));
	buttonLineColor->setText(tr("Color"));

	buttonFillColor->colorButton->setPersistentToolTip( tr("Fill color of table"));
	buttonFillColor->setText(tr("Color"));

	borderLineStyleLabel->setText(tr("Type"));
	borderLineWidthLabel->setText(tr("Width"));
}

void SMTableStyleWidget::setBorders(const TableBorder& left, const TableBorder& right,
									const TableBorder& top, const TableBorder& bottom)
{
	m_leftBorder = left;
	m_rightBorder = right;
	m_topBorder = top;
	m_bottomBorder = bottom;

	// Select the sides that have a border so the line list shows them. Without
	// this, a side whose selection went stale (e.g. its line was removed, then
	// restored by a reset) keeps a border value the widget never displays.
	TableSides sel = TableSide::None;
	if (!left.isNull())
		sel |= TableSide::Left;
	if (!right.isNull())
		sel |= TableSide::Right;
	if (!top.isNull())
		sel |= TableSide::Top;
	if (!bottom.isNull())
		sel |= TableSide::Bottom;

	bool b = sideSelector->blockSignals(true);
	sideSelector->setSelection(sel);
	sideSelector->blockSignals(b);

	// Programmatic refresh: sync m_lastSelection so the selection-change
	// handler does not treat this as a user toggle.
	m_lastSelection = sel;

	on_sideSelector_selectionChanged();
}

void SMTableStyleWidget::on_sideSelector_selectionChanged()
{
	TableSides newSelection = sideSelector->selection();
	TableSides changedSides = newSelection ^ m_lastSelection;
	bool turnedOn = (newSelection & changedSides) != 0;

	m_lastSelection = newSelection;

	// When sides are toggled on/off, mirror m_currentBorder (or null) to those sides
	// and emit a bordersChanged so the controller persists into the style.
	if (changedSides != TableSide::None)
	{
		TableBorder borderToApply;
		if (turnedOn)
		{
			if (m_currentBorder.isNull())
				m_currentBorder = TableBorder(1.0, Qt::SolidLine, "Black", 100);
			borderToApply = m_currentBorder;
		}
		// else borderToApply stays a null TableBorder, meaning "remove the border"

		if (changedSides & TableSide::Left)   m_leftBorder = borderToApply;
		if (changedSides & TableSide::Right)  m_rightBorder = borderToApply;
		if (changedSides & TableSide::Top)    m_topBorder = borderToApply;
		if (changedSides & TableSide::Bottom) m_bottomBorder = borderToApply;

		emit bordersChanged(changedSides, borderToApply);
	}

	// Refresh the border-line list to show the border on the currently-selected sides.
	State borderState = Unset;

	m_currentBorder = TableBorder();

	auto considerSide = [&](TableSide side, const TableBorder& border)
	{
		if (!(newSelection & side))
			return;
		if (borderState == Unset && !border.isNull())
		{
			m_currentBorder = border;
			borderState = Set;
		}
		else if (m_currentBorder != border)
		{
			borderState = TriState;
		}
	};
	considerSide(TableSide::Left,   m_leftBorder);
	considerSide(TableSide::Right,  m_rightBorder);
	considerSide(TableSide::Top,    m_topBorder);
	considerSide(TableSide::Bottom, m_bottomBorder);

	const bool enable = (borderState != Unset);
	addBorderLineButton->setEnabled(enable);
	removeBorderLineButton->setEnabled(borderState != Unset);
	borderLineList->setEnabled(enable);

	if (borderState == TriState)
		m_currentBorder = TableBorder();

	int previousRow = borderLineList->currentRow();
	updateBorderLineList();
	if (previousRow >= 0 && previousRow < borderLineList->count())
		borderLineList->setCurrentRow(previousRow);
}

void SMTableStyleWidget::on_borderLineList_currentRowChanged(int row)
{
	if (row == -1)
	{
		borderLineWidth->setEnabled(false);
		borderLineWidthLabel->setEnabled(false);
		buttonLineColor->setEnabled(false);
		borderLineStyle->setEnabled(false);
		borderLineStyleLabel->setEnabled(false);
		return;
	}

	const QList<TableBorderLine>& lines = m_currentBorder.borderLines();
	if (row >= lines.size())
		return;
	const TableBorderLine& line = lines.at(row);

	borderLineWidth->setEnabled(true);
	borderLineWidthLabel->setEnabled(true);
	buttonLineColor->setEnabled(true);
	borderLineStyle->setEnabled(true);
	borderLineStyleLabel->setEnabled(true);

	borderLineWidth->showValue(line.width());
	buttonLineColor->setColor(line.color(), line.shade());
	borderLineStyle->setCurrentIndex(static_cast<int>(line.style()) - 1);
}

void SMTableStyleWidget::on_addBorderLineButton_clicked()
{
	m_currentBorder.addBorderLine(TableBorderLine(1.0, Qt::SolidLine, "Black", 100));
	mirrorCurrentBorderToSelectedSides();
	updateBorderLineList();
	emit bordersChanged(sideSelector->selection(), m_currentBorder);
}

void SMTableStyleWidget::on_removeBorderLineButton_clicked()
{
	int index = borderLineList->currentRow();
	if (index < 0)
		return;
	m_currentBorder.removeBorderLine(index);
	mirrorCurrentBorderToSelectedSides();
	updateBorderLineList();
	emit bordersChanged(sideSelector->selection(), m_currentBorder);
}

void SMTableStyleWidget::on_borderLineWidth_valueChanged(double width)
{
	int index = borderLineList->currentRow();
	if (index < 0)
		return;
	TableBorderLine line = m_currentBorder.borderLines().at(index);
	line.setWidth(width);
	m_currentBorder.replaceBorderLine(index, line);
	mirrorCurrentBorderToSelectedSides();
	updateBorderLineListItem();
	emit bordersChanged(sideSelector->selection(), m_currentBorder);
}

void SMTableStyleWidget::borderLineColorChanged()
{
	int index = borderLineList->currentRow();
	if (index < 0)
		return;
	TableBorderLine line = m_currentBorder.borderLines().at(index);
	QString color = buttonLineColor->colorButton->colorName();
	if (color == CommonStrings::tr_NoneColor)
		color = CommonStrings::None;
	line.setColor(color);
	line.setShade(buttonLineColor->colorButton->colorData().Shade);
	m_currentBorder.replaceBorderLine(index, line);
	mirrorCurrentBorderToSelectedSides();
	updateBorderLineListItem();
	emit bordersChanged(sideSelector->selection(), m_currentBorder);
}

void SMTableStyleWidget::on_borderLineStyle_activated(int style)
{
	int index = borderLineList->currentRow();
	if (index < 0)
		return;
	TableBorderLine line = m_currentBorder.borderLines().at(index);
	line.setStyle(static_cast<Qt::PenStyle>(style + 1));
	m_currentBorder.replaceBorderLine(index, line);
	mirrorCurrentBorderToSelectedSides();
	updateBorderLineListItem();
	emit bordersChanged(sideSelector->selection(), m_currentBorder);
}

void SMTableStyleWidget::on_conditionalAreaComboBox_currentIndexChanged(int index)
{
	if (index < 0)
		return;
	m_currentArea = static_cast<TableArea>(conditionalAreaComboBox->itemData(index).toInt());
	emit conditionalAreaChanged(m_currentArea);
}

void SMTableStyleWidget::mirrorCurrentBorderToSelectedSides()
{
	TableSides sides = sideSelector->selection();
	if (sides & TableSide::Left)   m_leftBorder = m_currentBorder;
	if (sides & TableSide::Right)  m_rightBorder = m_currentBorder;
	if (sides & TableSide::Top)    m_topBorder = m_currentBorder;
	if (sides & TableSide::Bottom) m_bottomBorder = m_currentBorder;
}

void SMTableStyleWidget::updateBorderLineList()
{
	borderLineList->clear();
	for (const TableBorderLine& line : m_currentBorder.borderLines())
	{
		QString text = QString(" %1%2 %3").arg(line.width()).arg(borderLineWidth->suffix(), CommonStrings::translatePenStyleName(line.style()));
		if (line.color() != CommonStrings::None)
		{
			QPixmap icon = getWidePixmap(getColor(line.color(), line.shade()));
			borderLineList->addItem(new QListWidgetItem(icon, text, borderLineList));
		}
		else
		{
			borderLineList->addItem(new QListWidgetItem(text, borderLineList));
		}
	}
	removeBorderLineButton->setEnabled(borderLineList->count() > 0);
}

void SMTableStyleWidget::updateBorderLineListItem()
{
	QListWidgetItem* item = borderLineList->currentItem();
	if (!item)
		return;

	QString text = QString(" %1%2 %3").arg(borderLineWidth->getValue()).arg(borderLineWidth->suffix(), CommonStrings::translatePenStyleName(static_cast<Qt::PenStyle>(borderLineStyle->currentIndex() + 1)));
	if (buttonLineColor->colorButton->colorName() != CommonStrings::None)
	{
		QPixmap icon = getWidePixmap(getColor(buttonLineColor->colorButton->colorName(), buttonLineColor->colorButton->colorData().Shade));
		item->setIcon(icon);
	}
	item->setText(text);
}

QColor SMTableStyleWidget::getColor(const QString& colorName, int shade) const
{
	if (!m_Doc)
		return QColor();
	return ScColorEngine::getDisplayColor(m_Doc->PageColors.value(colorName), m_Doc, shade);
}

void SMTableStyleWidget::setCheck(QCheckBox* cb, bool v)
{
	bool b = cb->blockSignals(true);
	cb->setChecked(v);
	cb->blockSignals(b);
}

void SMTableStyleWidget::setSpin(QSpinBox* sb, int v, bool enabled)
{
	bool b = sb->blockSignals(true);
	sb->setValue(v);
	sb->setEnabled(enabled);
	sb->blockSignals(b);
}

void SMTableStyleWidget::setCombo(QComboBox* cb, int index)
{
	bool blocked = cb->blockSignals(true);
	cb->setCurrentIndex(index);
	cb->blockSignals(blocked);
}

void SMTableStyleWidget::rebuildAreaCombo(TableStyle* tableStyle)
{
	bool b = conditionalAreaComboBox->blockSignals(true);
	conditionalAreaComboBox->clear();
	// Whole Table is always available (the style's own fill/borders).
	conditionalAreaComboBox->addItem(tr("Whole Table"), static_cast<int>(TableArea::WholeTable));
	conditionalAreaComboBox->addItem(tr("Body Cell"), static_cast<int>(TableArea::BodyCell));
	if (tableStyle->headerRows() > 0)
		conditionalAreaComboBox->addItem(tr("Header Row"), static_cast<int>(TableArea::HeaderRow));
	if (tableStyle->totalRows() > 0)
		conditionalAreaComboBox->addItem(tr("Total Row"), static_cast<int>(TableArea::TotalRow));
	if (tableStyle->bandedRows())
	{
		conditionalAreaComboBox->addItem(tr("Banded Row (odd)"), static_cast<int>(TableArea::BandedRowOdd));
		conditionalAreaComboBox->addItem(tr("Banded Row (even)"), static_cast<int>(TableArea::BandedRowEven));
	}
	if (tableStyle->bandedColumns())
	{
		conditionalAreaComboBox->addItem(tr("Banded Column (odd)"), static_cast<int>(TableArea::BandedColOdd));
		conditionalAreaComboBox->addItem(tr("Banded Column (even)"), static_cast<int>(TableArea::BandedColEven));
	}
	if (tableStyle->firstColumn())
		conditionalAreaComboBox->addItem(tr("First Column"), static_cast<int>(TableArea::FirstColumn));
	if (tableStyle->lastColumn())
		conditionalAreaComboBox->addItem(tr("Last Column"), static_cast<int>(TableArea::LastColumn));
	if (tableStyle->headerRows() > 0 && tableStyle->firstColumn())
		conditionalAreaComboBox->addItem(tr("Top Left Cell"), static_cast<int>(TableArea::TopLeftCell));
	if (tableStyle->headerRows() > 0 && tableStyle->lastColumn())
		conditionalAreaComboBox->addItem(tr("Top Right Cell"), static_cast<int>(TableArea::TopRightCell));
	if (tableStyle->totalRows() > 0 && tableStyle->firstColumn())
		conditionalAreaComboBox->addItem(tr("Bottom Left Cell"), static_cast<int>(TableArea::BottomLeftCell));
	if (tableStyle->totalRows() > 0 && tableStyle->lastColumn())
		conditionalAreaComboBox->addItem(tr("Bottom Right Cell"), static_cast<int>(TableArea::BottomRightCell));
	// Restore selection to current area if still present, else Whole Table.
	int idx = conditionalAreaComboBox->findData(static_cast<int>(m_currentArea));
	if (idx < 0)
	{
		idx = 0;
		m_currentArea = TableArea::WholeTable;
	}
	conditionalAreaComboBox->setCurrentIndex(idx);
	conditionalAreaComboBox->blockSignals(b);
}

void SMTableStyleWidget::showFillForCurrentArea(TableStyle *tableStyle)
{
	// Whole Table edits the style's own fill (with parent-inheritance UI).
	if (m_currentArea == TableArea::WholeTable)
	{
		const TableStyle *parent = dynamic_cast<const TableStyle*>(tableStyle->parentStyle());
		bool hasParent = tableStyle->hasParent() && parent && parent->hasName() && tableStyle->parent() != "";
		if (hasParent)
			buttonFillColor->setColor(tableStyle->fillColor(), qRound(tableStyle->fillShade()), parent->fillColor(), qRound(parent->fillShade()), tableStyle->isInhFillColor() && tableStyle->isInhFillShade());
		else
			buttonFillColor->setColor(tableStyle->fillColor(), qRound(tableStyle->fillShade()));
		return;
	}

	// A conditional area edits its own anonymous CellStyle -- no parent UI.
	// Resolve through the document cell styles so inherited fill/shade come
	// from the based-on parent (matching what the table renders), and report
	// the real inherited state rather than hardcoding "not inherited".
	CellStyle cs = tableStyle->conditionalStyle(m_currentArea);
	cs.setContext(&m_Doc->cellStyles());

	const CellStyle *parent = dynamic_cast<const CellStyle*>(cs.parentStyle());
	bool hasParent =  cs.hasParent() && parent != nullptr && parent->hasName() && cs.parent() != "";
	if (hasParent)
		buttonFillColor->setColor(cs.fillColor(), qRound(cs.fillShade()), parent->fillColor(), qRound(parent->fillShade()), cs.isInhFillColor() && cs.isInhFillShade());
	else
		buttonFillColor->setColor(cs.fillColor(), qRound(cs.fillShade()));

}

void SMTableStyleWidget::showBordersForCurrentArea(TableStyle *tableStyle)
{
	if (m_currentArea == TableArea::WholeTable)
	{
		setBorders(tableStyle->leftBorder(), tableStyle->rightBorder(), tableStyle->topBorder(), tableStyle->bottomBorder());
	}
	else
	{
		CellStyle cs = tableStyle->conditionalStyle(m_currentArea);
		cs.setContext(&m_Doc->cellStyles());
		setBorders(cs.leftBorder(), cs.rightBorder(), cs.topBorder(), cs.bottomBorder());
	}
}

void SMTableStyleWidget::showParagraphStyleForCurrentArea(TableStyle *tableStyle)
{
	QString psName;
	if (m_currentArea == TableArea::WholeTable)
	{
		psName = tableStyle->paragraphStyleName();
	}
	else
	{
		// Resolve through the document cell styles so an inherited paragraph
		// style name comes from the based-on parent, matching the render.
		CellStyle cs = tableStyle->conditionalStyle(m_currentArea);
		cs.setContext(&m_Doc->cellStyles());
		psName = cs.paragraphStyleName();
	}
	bool b = paragraphStyleComboBox->blockSignals(true);
	paragraphStyleComboBox->setStyle(psName);
	paragraphStyleComboBox->blockSignals(b);
}

void SMTableStyleWidget::showBasedOnForCurrentArea(TableStyle *tableStyle)
{
	bool isCellArea = (m_currentArea != TableArea::WholeTable);
	basedOnComboBox->setEnabled(isCellArea);
	QString parentName = isCellArea ? tableStyle->conditionalStyle(m_currentArea).parent() : QString();
	bool b = basedOnComboBox->blockSignals(true);
	basedOnComboBox->setStyle(parentName);
	basedOnComboBox->blockSignals(b);
}
