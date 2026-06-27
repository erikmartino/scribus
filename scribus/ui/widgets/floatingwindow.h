#ifndef STICKYPOPUP_H
#define STICKYPOPUP_H

#include <QToolButton>
#include <QWidget>
#include <QVBoxLayout>

class FloatingWindow : public QWidget
{
	Q_OBJECT

public:
	explicit FloatingWindow(QWidget * child, QWidget *parent = nullptr);

	QWidget *child();
	QWidget *reference();

	void setIsMovable(bool movable);
	bool isMovable() { return m_isMovable; };

public slots:
	void iconSetChange();

protected:
	bool eventFilter(QObject *obj, QEvent *event) override;
	void keyPressEvent(QKeyEvent *event) override;
	void hideEvent(QHideEvent *event) override;
	void showEvent(QShowEvent *event) override;
	bool event(QEvent *event) override;

private:
	QWidget * m_child { nullptr };
	QWidget * m_reference { nullptr };
	QWidget * m_handle { nullptr };
	QWidget * m_header { nullptr };
	QVBoxLayout * m_layout { nullptr };
	QToolButton* buttonClose { nullptr };

	QPoint m_mousePos;
	bool m_isMovable {true};

	/*!
	 * \brief Screen size of all screens
	 * \return
	 */
	QSize screenSize() const;

	/*!
	 * \brief Calculate screen position relative to reference() widget.
	 */
	void calculatePosition();

signals:
	void closed();

public slots:
	void show(QWidget *reference = nullptr);
	void updateSize();
};

#endif // STICKYPOPUP_H
