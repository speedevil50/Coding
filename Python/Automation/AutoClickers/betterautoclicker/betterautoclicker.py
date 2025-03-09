import sys
from PySide6.QtWidgets import QApplication, QMainWindow, QPushButton, QVBoxLayout, QWidget, QLabel, QLineEdit, QHBoxLayout, QCheckBox, QMessageBox, QInputDialog
from PySide6.QtCore import QTimer, Qt, QMetaObject
import pyautogui
import random
import keyboard  # For global hotkeys
import winsound  # For sound notifications
import json
import os

class AutoClicker(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("BetterAutoClicker - Just Initialized - Version 1.0 | Python")
        self.setGeometry(100, 100, 400, 300)
        self.setWindowFlags(Qt.Window | Qt.WindowMinimizeButtonHint | Qt.WindowCloseButtonHint)

        self.interval_label = QLabel("Interval (ms):", self)
        self.interval_input = QLineEdit(self)
        self.interval_input.setPlaceholderText("Enter interval in milliseconds")
        self.interval_input.setToolTip("Time interval between clicks in milliseconds")
        self.interval_input.setText("1000")  # Default value

        self.offset_checkbox = QCheckBox("Enable Random Offset", self)
        self.offset_checkbox.setToolTip("Toggle random offset for the interval")
        self.offset_checkbox.stateChanged.connect(self.toggle_offset_input)
        self.offset_checkbox.setChecked(False)
        self.offset_checkbox.setEnabled(False)

        self.offset_label = QLabel("Random Offset (ms):", self)
        self.offset_input = QLineEdit(self)
        self.offset_input.setPlaceholderText("Enter max random offset in milliseconds")
        self.offset_input.setToolTip("Maximum random offset added to the interval")
        self.offset_input.setEnabled(False)
        self.offset_input.setText("0")  # Default value

        self.click_count_label = QLabel("Click Count: 0", self)
        self.status_label = QLabel("Status: Idle", self)

        self.stop_after_label = QLabel("Stop After Clicks:", self)
        self.stop_after_input = QLineEdit(self)
        self.stop_after_input.setPlaceholderText("Enter number of clicks (optional, -1 for indefinite)")
        self.stop_after_input.setToolTip("Number of clicks after which the auto-clicker will stop")

        self.dark_mode_checkbox = QCheckBox("Dark Mode", self)
        self.dark_mode_checkbox.setChecked(True)
        self.dark_mode_checkbox.setEnabled(False)
        self.toggle_dark_mode(Qt.Checked)  # Apply dark mode by default

        self.start_button = QPushButton("Start", self)
        self.stop_button = QPushButton("Stop", self)
        self.help_button = QPushButton("Help", self)
        self.hotkey_button = QPushButton("Set Hotkey", self)
        self.stop_button.setEnabled(False)

        self.start_button.clicked.connect(self.start_clicking)
        self.stop_button.clicked.connect(self.stop_clicking)
        self.help_button.clicked.connect(self.show_help)
        self.hotkey_button.clicked.connect(self.set_hotkey)

        layout = QVBoxLayout()
        layout.addWidget(self.interval_label)
        layout.addWidget(self.interval_input)
        layout.addWidget(self.offset_checkbox)
        layout.addWidget(self.offset_label)
        layout.addWidget(self.offset_input)
        layout.addWidget(self.stop_after_label)
        layout.addWidget(self.stop_after_input)
        layout.addWidget(self.click_count_label)
        layout.addWidget(self.status_label)
        layout.addWidget(self.dark_mode_checkbox)

        button_layout = QHBoxLayout()
        button_layout.addWidget(self.start_button)
        button_layout.addWidget(self.stop_button)
        button_layout.addWidget(self.help_button)
        button_layout.addWidget(self.hotkey_button)
        layout.addLayout(button_layout)

        container = QWidget()
        container.setLayout(layout)
        self.setCentralWidget(container)

        self.timer = QTimer()
        self.timer.timeout.connect(self.click)
        self.click_count = 0
        self.stop_after_clicks = None
        self.hotkey = 'ctrl+shift+s'

        # Set up global hotkey
        keyboard.add_hotkey(self.hotkey, self.toggle_clicking_thread_safe)

        # Load settings
        self.load_settings()

    def start_clicking(self):
        try:
            interval = int(self.interval_input.text())
            offset = int(self.offset_input.text()) if self.offset_checkbox.isChecked() else 0
            stop_after_clicks = int(self.stop_after_input.text()) if self.stop_after_input.text() else None
            if stop_after_clicks == -1:
                self.stop_after_clicks = None
            else:
                self.stop_after_clicks = stop_after_clicks
            self.timer.start(interval + random.randint(0, offset))
            self.start_button.setEnabled(False)
            self.stop_button.setEnabled(True)
            self.status_label.setText("Status: Running")
            self.setWindowTitle(f"BetterAutoClicker - Running at {interval}ms ± {offset}ms - Version 1.0 | Python")
            winsound.PlaySound("SystemAsterisk", winsound.SND_ALIAS | winsound.SND_ASYNC)  # Start sound
        except ValueError:
            QMessageBox.warning(self, "Input Error", "Please enter valid numbers for interval and offset.")

    def stop_clicking(self):
        self.setWindowTitle("BetterAutoClicker - Idling - Version 1.0 | Python")
        self.start_button.setEnabled(True)
        self.stop_button.setEnabled(False)
        self.status_label.setText("Status: Idle")
        self.timer.stop()
        winsound.PlaySound("SystemExit", winsound.SND_ALIAS | winsound.SND_ASYNC)  # Stop sound

    def click(self):
        pyautogui.click()
        self.click_count += 1
        self.click_count_label.setText(f"Click Count: {self.click_count}")
        if self.stop_after_clicks and self.click_count >= self.stop_after_clicks:
            self.stop_clicking()

    def toggle_clicking(self):
        if self.timer.isActive():
            self.stop_clicking()
        else:
            self.start_clicking()

    def toggle_clicking_thread_safe(self):
        QMetaObject.invokeMethod(self, "toggle_clicking", Qt.QueuedConnection)

    def toggle_dark_mode(self, state):
        if state == Qt.Checked:
            self.setStyleSheet("background-color: #2e2e2e; color: white;")
        else:
            self.setStyleSheet("")

    def toggle_offset_input(self, state):
        self.offset_input.setEnabled(state == Qt.Checked)

    def set_hotkey(self):
        hotkey, ok = QInputDialog.getText(self, "Set Hotkey", "Enter new hotkey (e.g., ctrl+shift+s):")
        if ok and hotkey:
            keyboard.remove_hotkey(self.hotkey)
            self.hotkey = hotkey
            keyboard.add_hotkey(self.hotkey, self.toggle_clicking_thread_safe)
            QMessageBox.information(self, "Hotkey Set", f"New hotkey set to: {self.hotkey}")

    def show_help(self):
        help_text = (
            "BetterAutoClicker - Help Guide\n\n"
            "1. Interval (ms): Set the time interval between clicks in milliseconds.\n"
            "2. Enable Random Offset: Toggle random offset for the interval.\n"
            "3. Random Offset (ms): Set the maximum random offset added to the interval.\n"
            "4. Stop After Clicks: Set the number of clicks after which the auto-clicker will stop (optional, -1 for indefinite).\n"
            "5. Dark Mode: Toggle dark mode for the application.\n"
            "6. Start: Start the auto-clicker.\n"
            "7. Stop: Stop the auto-clicker.\n"
            "8. Help: Show this help guide.\n"
            "9. Set Hotkey: Set a custom hotkey to start/stop the auto-clicker.\n"
            "10. Global Hotkey: Use the set hotkey to start/stop the auto-clicker.\n"
        )
        QMessageBox.information(self, "Help", help_text)

    def load_settings(self):
        if os.path.exists("settings.json"):
            with open("settings.json", "r") as file:
                settings = json.load(file)
                self.interval_input.setText(str(settings.get("interval", "1000")))
                self.offset_input.setText(str(settings.get("offset", "0")))
                self.stop_after_input.setText(str(settings.get("stop_after", "")))
                self.offset_checkbox.setChecked(settings.get("offset_enabled", False))
                if settings.get("dark_mode", True):
                    self.dark_mode_checkbox.setChecked(True)
                    self.toggle_dark_mode(Qt.Checked)
                self.hotkey = settings.get("hotkey", 'ctrl+shift+s')
                keyboard.add_hotkey(self.hotkey, self.toggle_clicking_thread_safe)

    def closeEvent(self, event):
        settings = {
            "interval": self.interval_input.text(),
            "offset": self.offset_input.text(),
            "stop_after": self.stop_after_input.text(),
            "offset_enabled": self.offset_checkbox.isChecked(),
            "dark_mode": self.dark_mode_checkbox.isChecked(),
            "hotkey": self.hotkey
        }
        with open("settings.json", "w") as file:
            json.dump(settings, file)
        event.accept()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = AutoClicker()
    window.show()
    sys.exit(app.exec())