import pygame
import secrets
import string
from cryptography.fernet import Fernet
import os

pygame.init()

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GREEN = (0, 255, 0)
RED = (255, 0, 0)
BLUE = (0, 0, 255)
GRAY = (200, 200, 200)

WIDTH, HEIGHT = 600, 500  # Increased window size
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("PassGuard")

font = pygame.font.SysFont("Arial", 20)

password_length = 12
use_special_chars = True
use_numbers = True
use_uppercase = True
use_lowercase = True
special_characters = string.punctuation
min_uppercase = 0
min_numbers = 0
min_special = 0

def at_least_one_enabled():
    """Ensure at least one option is enabled"""
    return use_special_chars or use_numbers or use_uppercase or use_lowercase

def generate_password():
    chars = ""
    if use_special_chars:
        chars += special_characters
    if use_numbers:
        chars += string.digits
    if use_uppercase:
        chars += string.ascii_uppercase
    if use_lowercase:
        chars += string.ascii_lowercase

    password = ''.join(secrets.choice(chars) for _ in range(password_length))

    # Ensure the password meets the minimum requirements for each type
    while (use_uppercase and sum(1 for c in password if c.isupper()) < min_uppercase) or \
          (use_numbers and sum(1 for c in password if c.isdigit()) < min_numbers) or \
          (use_special_chars and sum(1 for c in password if c in special_characters) < min_special):
        password = ''.join(secrets.choice(chars) for _ in range(password_length))

    return password

def encrypt_password(password, key_file="key.key"):
    if not os.path.exists(key_file):
        key = Fernet.generate_key()
        with open(key_file, "wb") as keyfile:
            keyfile.write(key)
    else:
        with open(key_file, "rb") as keyfile:
            key = keyfile.read()

    cipher_suite = Fernet(key)
    encrypted_password = cipher_suite.encrypt(password.encode())
    return encrypted_password

def save_password(encrypted_password, filename="passwords.txt"):
    with open(filename, "ab") as file:
        file.write(encrypted_password + b'\n')

def settings_menu():
    global password_length, use_special_chars, use_numbers, use_uppercase, use_lowercase
    global min_uppercase, min_numbers, min_special, special_characters

    running = True
    warning = ""

    while running:
        screen.fill(GRAY)

        title_text = font.render("Settings", True, BLACK)
        screen.blit(title_text, (WIDTH // 2 - title_text.get_width() // 2, 30))

        length_text = font.render(f"Password Length: {password_length}", True, BLACK)
        screen.blit(length_text, (50, 80))

        dec_button = pygame.Rect(250, 80, 30, 30)
        pygame.draw.rect(screen, RED, dec_button)
        screen.blit(font.render("-", True, WHITE), (260, 85))

        inc_button = pygame.Rect(290, 80, 30, 30)
        pygame.draw.rect(screen, GREEN, inc_button)
        screen.blit(font.render("+", True, WHITE), (300, 85))

        # Options for enabling/disabling character types
        options = [
            ("Special Chars", "use_special_chars"),
            ("Numbers", "use_numbers"),
            ("Uppercase", "use_uppercase"),
            ("Lowercase", "use_lowercase")
        ]
        y_offset = 130
        buttons = []

        for i, (label, var_name) in enumerate(options):
            value = globals()[var_name]  
            text = font.render(f"{label}: {'ON' if value else 'OFF'}", True, BLACK)
            screen.blit(text, (50, y_offset + (i * 40)))

            button = pygame.Rect(250, y_offset + (i * 40), 60, 30)
            color = GREEN if value else RED
            pygame.draw.rect(screen, color, button)

            toggle_text = font.render("ON" if value else "OFF", True, WHITE)
            screen.blit(toggle_text, (260, y_offset + (i * 40) + 5))

            buttons.append((button, var_name))

        # Minimum requirements for characters
        min_requirements_text = font.render("Min. Uppercase: " + str(min_uppercase), True, BLACK)
        screen.blit(min_requirements_text, (50, 270))

        min_uppercase_inc = pygame.Rect(250, 270, 30, 30)
        pygame.draw.rect(screen, GREEN, min_uppercase_inc)
        screen.blit(font.render("+", True, WHITE), (260, 275))

        min_uppercase_dec = pygame.Rect(290, 270, 30, 30)
        pygame.draw.rect(screen, RED, min_uppercase_dec)
        screen.blit(font.render("-", True, WHITE), (300, 275))

        # Similar setup for numbers and special characters
        min_numbers_text = font.render("Min. Numbers: " + str(min_numbers), True, BLACK)
        screen.blit(min_numbers_text, (50, 310))
        min_numbers_inc = pygame.Rect(250, 310, 30, 30)
        pygame.draw.rect(screen, GREEN, min_numbers_inc)
        screen.blit(font.render("+", True, WHITE), (260, 315))

        min_numbers_dec = pygame.Rect(290, 310, 30, 30)
        pygame.draw.rect(screen, RED, min_numbers_dec)
        screen.blit(font.render("-", True, WHITE), (300, 315))

        min_special_text = font.render("Min. Special Chars: " + str(min_special), True, BLACK)
        screen.blit(min_special_text, (50, 350))

        min_special_inc = pygame.Rect(250, 350, 30, 30)
        pygame.draw.rect(screen, GREEN, min_special_inc)
        screen.blit(font.render("+", True, WHITE), (260, 355))

        min_special_dec = pygame.Rect(290, 350, 30, 30)
        pygame.draw.rect(screen, RED, min_special_dec)
        screen.blit(font.render("-", True, WHITE), (300, 355))

        # Back button
        back_button = pygame.Rect(WIDTH // 2 - 50, HEIGHT - 50, 100, 40)
        pygame.draw.rect(screen, BLUE, back_button)
        screen.blit(font.render("Back", True, WHITE), (WIDTH // 2 - 25, HEIGHT - 40))

        if warning:
            warning_text = font.render(warning, True, RED)
            screen.blit(warning_text, (WIDTH // 2 - warning_text.get_width() // 2, HEIGHT - 80))

        pygame.display.flip()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.MOUSEBUTTONDOWN:
                x, y = pygame.mouse.get_pos()

                if dec_button.collidepoint(x, y) and password_length > 4:
                    password_length -= 1
                if inc_button.collidepoint(x, y) and password_length < 256: 
                    password_length += 1
                if inc_button.collidepoint(x, y) and password_length < 64:
                    warning = "generally, most websites only support up to 64 char for passwords"
                if inc_button.collidepoint(x, y) and password_length > 8:
                    warning = "Passwords at this low number of characters can be easily be guessed"

                for button, var_name in buttons:
                    if button.collidepoint(x, y):
                        if globals()[var_name]:  
                            if sum(globals()[v] for _, v in options) > 1:
                                globals()[var_name] = not globals()[var_name]
                                warning = ""
                            else:
                                warning = "At least one option must be enabled!"
                        else:
                            globals()[var_name] = not globals()[var_name]
                            warning = ""

                # Adjust minimum requirements
                if min_uppercase_inc.collidepoint(x, y) and min_uppercase < 5:
                    min_uppercase += 1
                if min_uppercase_dec.collidepoint(x, y) and min_uppercase > 0:
                    min_uppercase -= 1
                if min_numbers_inc.collidepoint(x, y) and min_numbers < 5:
                    min_numbers += 1
                if min_numbers_dec.collidepoint(x, y) and min_numbers > 0:
                    min_numbers -= 1
                if min_special_inc.collidepoint(x, y) and min_special < 5:
                    min_special += 1
                if min_special_dec.collidepoint(x, y) and min_special > 0:
                    min_special -= 1

                if back_button.collidepoint(x, y):
                    running = False

def draw_main_menu():
    screen.fill(WHITE)
    title_text = font.render("PassGuard - Password Generator", True, BLACK)
    screen.blit(title_text, (WIDTH // 2 - title_text.get_width() // 2, 30))

    buttons = [
        ("Generate Password", 100, BLUE),
        ("Save Password", 160, GREEN),
        ("Settings", 220, GRAY)
    ]

    for text, y, color in buttons:
        button = pygame.Rect(150, y, 200, 40)
        pygame.draw.rect(screen, color, button)
        btn_text = font.render(text, True, WHITE)
        screen.blit(btn_text, (button.x + button.width // 2 - btn_text.get_width() // 2,
                               button.y + button.height // 2 - btn_text.get_height() // 2))

def main():
    running = True
    password = None
    encrypted_password = None

    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.MOUSEBUTTONDOWN:
                x, y = pygame.mouse.get_pos()

                if 150 <= x <= 350 and 100 <= y <= 140:
                    password = generate_password()
                    print(f"Generated password: {password}")

                if 150 <= x <= 350 and 160 <= y <= 200 and password:
                    encrypted_password = encrypt_password(password)
                    save_password(encrypted_password)
                    print("Password saved.")

                if 150 <= x <= 350 and 220 <= y <= 260:
                    settings_menu()

        draw_main_menu()
        pygame.display.flip()

    pygame.quit()

if __name__ == "__main__":
    main()
