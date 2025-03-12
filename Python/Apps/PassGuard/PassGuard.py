import secrets
import string
from cryptography.fernet import Fernet
import os

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

# Function to generate an encryption key and encrypt the password
def encrypt_password(password, key_file="key.key"):
    # Check if key exists, if not, generate and save it
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

# Function to save the encrypted password to a file
def save_password(encrypted_password, filename="passwords.txt"):
    with open(filename, "ab") as file:
        file.write(encrypted_password + b'\n')

# Example of how the program works
def main():
    password_length = int(input("Enter desired password length: "))
    password = generate_password(length=password_length)
    print(f"Generated password: {password}")

    encrypted_password = encrypt_password(password)
    print("Password encrypted.")

    save_password(encrypted_password)
    print("Password saved.")

if __name__ == "__main__":
    main()