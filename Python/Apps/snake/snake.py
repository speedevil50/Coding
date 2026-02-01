import pygame
import sys
import random

# Initialize pygame
pygame.init()

# Constants
SCREEN_WIDTH = 800
SCREEN_HEIGHT = 600
FPS = 60

# Colors
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)

# Initialize screen
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("Snake Game")

# Clock for controlling frame rate
clock = pygame.time.Clock()

# Snake setup
snake_pos = [(100, 50), (90, 50), (80, 50)]  # Initial snake body
snake_dir = "RIGHT"  # Initial direction
snake_speed = 10

# Food setup
food_pos = []
food_count = 1
food_spawn = True

# Score setup
score = 0
font = pygame.font.SysFont("arial", 24)

# Function to move the snake
def move_snake():
    head_x, head_y = snake_pos[0]

    if snake_dir == "UP":
        new_head = (head_x, head_y - snake_speed)
    elif snake_dir == "DOWN":
        new_head = (head_x, head_y + snake_speed)
    elif snake_dir == "LEFT":
        new_head = (head_x - snake_speed, head_y)
    elif snake_dir == "RIGHT":
        new_head = (head_x + snake_speed, head_y)

    snake_pos.insert(0, new_head)
    snake_pos.pop()

# Function to spawn food
def spawn_food():
    global food_pos, food_spawn
    if not food_spawn:
        food_pos = []
        for _ in range(food_count):
            food_pos.append((random.randint(0, (SCREEN_WIDTH // 10) - 1) * 10, random.randint(0, (SCREEN_HEIGHT // 10) - 1) * 10))
        food_spawn = True

# Function to display score
def display_score():
    score_surface = font.render(f"Score: {score}", True, BLACK)
    screen.blit(score_surface, (10, 10))

# Function to check collisions
def check_collisions():
    global running, food_spawn, score

    # Check collision with walls
    head_x, head_y = snake_pos[0]
    if head_x < 0 or head_x >= SCREEN_WIDTH or head_y < 0 or head_y >= SCREEN_HEIGHT:
        running = False

    # Check collision with itself
    if snake_pos[0] in snake_pos[1:]:
        running = False

    # Check collision with food
    if snake_pos[0] in food_pos:
        food_pos.remove(snake_pos[0])  # Remove the food that was eaten
        snake_pos.append(snake_pos[-1])  # Grow the snake
        score += 1
        if len(food_pos) == 0:  # If no more food, spawn new food
            spawn_food()

def main_menu():
    global snake_speed, food_count
    menu_running = True
    selected_option = 0
    options = ["Start Game", "Snake Speed: {}".format(snake_speed), "Food Count: {}".format(food_count), "Quit"]

    while menu_running:
        screen.fill(WHITE)
        title_font = pygame.font.SysFont("arial", 48)
        menu_font = pygame.font.SysFont("arial", 24)

        title_surface = title_font.render("Snake Game", True, BLACK)
        screen.blit(title_surface, (SCREEN_WIDTH // 2 - title_surface.get_width() // 2, SCREEN_HEIGHT // 4))

        for i, option in enumerate(options):
            color = BLACK if i == selected_option else (100, 100, 100)
            option_surface = menu_font.render(option, True, color)
            screen.blit(option_surface, (SCREEN_WIDTH // 2 - option_surface.get_width() // 2, SCREEN_HEIGHT // 2 + i * 30))

        pygame.display.flip()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_UP:
                    selected_option = (selected_option - 1) % len(options)
                elif event.key == pygame.K_DOWN:
                    selected_option = (selected_option + 1) % len(options)
                elif event.key == pygame.K_RETURN:
                    if selected_option == 0:  # Start Game
                        menu_running = False
                    elif selected_option == 1:  # Snake Speed
                        snake_speed += 1 if snake_speed < 20 else -9
                        options[1] = "Snake Speed: {}".format(snake_speed)
                    elif selected_option == 2:  # Food Count
                        food_count += 1 if food_count < 5 else -4
                        options[2] = "Food Count: {}".format(food_count)
                    elif selected_option == 3:  # Quit
                        pygame.quit()
                        sys.exit()

def death_screen(final_score):
    death_running = True
    while death_running:
        screen.fill(WHITE)
        title_font = pygame.font.SysFont("arial", 48)
        menu_font = pygame.font.SysFont("arial", 24)

        title_surface = title_font.render("Game Over", True, BLACK)
        score_surface = menu_font.render(f"Final Score: {final_score}", True, BLACK)
        restart_surface = menu_font.render("Press R to Restart", True, BLACK)
        quit_surface = menu_font.render("Press ESC to Quit", True, BLACK)

        screen.blit(title_surface, (SCREEN_WIDTH // 2 - title_surface.get_width() // 2, SCREEN_HEIGHT // 4))
        screen.blit(score_surface, (SCREEN_WIDTH // 2 - score_surface.get_width() // 2, SCREEN_HEIGHT // 2 - 50))
        screen.blit(restart_surface, (SCREEN_WIDTH // 2 - restart_surface.get_width() // 2, SCREEN_HEIGHT // 2))
        screen.blit(quit_surface, (SCREEN_WIDTH // 2 - quit_surface.get_width() // 2, SCREEN_HEIGHT // 2 + 50))

        pygame.display.flip()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_r:  # R key
                    reset_game()
                    death_running = False
                    main()
                elif event.key == pygame.K_ESCAPE:  # ESC key
                    pygame.quit()
                    sys.exit()

def reset_game():
    global snake_pos, snake_dir, food_pos, food_spawn, score
    snake_pos = [(100, 50), (90, 50), (80, 50)]  # Reset snake body
    snake_dir = "RIGHT"  # Reset direction
    food_pos = []
    food_spawn = True  # Reset food spawn state
    score = 0  # Reset score

def main():
    global snake_dir, food_spawn, running, score

    main_menu()

    running = True
    score = 0

    while running:
        # Handle events
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_UP and snake_dir != "DOWN":
                    snake_dir = "UP"
                elif event.key == pygame.K_DOWN and snake_dir != "UP":
                    snake_dir = "DOWN"
                elif event.key == pygame.K_LEFT and snake_dir != "RIGHT":
                    snake_dir = "LEFT"
                elif event.key == pygame.K_RIGHT and snake_dir != "LEFT":
                    snake_dir = "RIGHT"

        # Game logic
        move_snake()
        check_collisions()
        spawn_food()

        # Drawing
        screen.fill(WHITE)
        for segment in snake_pos:
            pygame.draw.rect(screen, BLACK, pygame.Rect(segment[0], segment[1], 10, 10))
        for food in food_pos:
            pygame.draw.rect(screen, (255, 0, 0), pygame.Rect(food[0], food[1], 10, 10))
        display_score()

        # Update display
        pygame.display.flip()

        # Cap the frame rate
        clock.tick(FPS + snake_speed)

    death_screen(score)
    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()