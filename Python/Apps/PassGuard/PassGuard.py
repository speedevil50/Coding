import pygame
import secrets
import string
from cryptography.fernet import Fernet
import os

# Pygame setup
pygame.init()

# Colors
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GREEN = (0, 255, 0)
RED = (255, 0, 0)
BLUE = (0, 0, 255)

# Screen dimensions
WIDTH, HEIGHT = 500, 400
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("PassGuard")

# Font setup
font = pygame.font.SysFont("Arial", 20)

# Function to generate a random password
def generate_password(length=12, use_special_chars=True, use_numbers=True, use_uppercase=True, use_lowercase=True):
    chars = ""
    if use_special_chars:
        chars += string.punctuation
    if use_numbers:
        chars += string.digits
    if use_uppercase:
        chars += string.ascii_uppercase
    if use_lowercase:
        chars += string.ascii_lowercase

    password = ''.join(secrets.choice(chars) for _ in range(length))
    return password

# Function to encrypt password
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

# Function to save encrypted password
def save_password(encrypted_password, filename="passwords.txt"):
    with open(filename, "ab") as file:
        file.write(encrypted_password + b'\n')

# Main menu UI
def draw_main_menu():
    screen.fill(WHITE)
    title_text = font.render("PassGuard - Password Generator", True, BLACK)
    screen.blit(title_text, (WIDTH // 2 - title_text.get_width() // 2, 30))

    # Generate password button
    gen_button = pygame.Rect(150, 100, 200, 40)
    pygame.draw.rect(screen, BLUE, gen_button)
    gen_button_text = font.render("Generate Password", True, WHITE)
    screen.blit(gen_button_text, (gen_button.x + gen_button.width // 2 - gen_button_text.get_width() // 2,
                                  gen_button.y + gen_button.height // 2 - gen_button_text.get_height() // 2))

    # Save password button
    save_button = pygame.Rect(150, 160, 200, 40)
    pygame.draw.rect(screen, GREEN, save_button)
    save_button_text = font.render("Save Password", True, WHITE)
    screen.blit(save_button_text, (save_button.x + save_button.width // 2 - save_button_text.get_width() // 2,
                                   save_button.y + save_button.height // 2 - save_button_text.get_height() // 2))

    # Instructions
    instruction_text = font.render("Click buttons to generate and save a password.", True, BLACK)
    screen.blit(instruction_text, (WIDTH // 2 - instruction_text.get_width() // 2, 300))

# Main function to run the app
def main():
    running = True
    password = None
    encrypted_password = None

    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.MOUSEBUTTONDOWN:
                mouse_x, mouse_y = pygame.mouse.get_pos()

                # Check if "Generate Password" button is clicked
                if 150 <= mouse_x <= 350 and 100 <= mouse_y <= 140:
                    password = generate_password()
                    print(f"Generated password: {password}")  # Show in console for now

                # Check if "Save Password" button is clicked
                if 150 <= mouse_x <= 350 and 160 <= mouse_y <= 200 and password:
                    encrypted_password = encrypt_password(password)
                    save_password(encrypted_password)
                    print("Password saved.")

        draw_main_menu()
        pygame.display.flip()

    pygame.quit()

if __name__ == "__main__":
    main()