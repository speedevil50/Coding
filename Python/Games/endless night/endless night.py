import pygame
import random

# Initialize pygame
pygame.init()

# Game Constants
WIDTH, HEIGHT = 800, 600
WORLD_WIDTH, WORLD_HEIGHT = 1600, 1200  # Larger world to move around
PLAYER_SPEED = 5
ENEMY_SPEED = 2
WHITE = (255, 255, 255)
RED = (255, 0, 0)
DARK_RED = (200, 0, 0)
GREEN = (0, 255, 0)
DARK_GREEN = (0, 200, 0)
BLACK = (0, 0, 0)
FONT = pygame.font.Font(None, 36)
HEALTH_PACK_COLOR = (0, 255, 255)

# Setup display
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Endless Night")

def draw_text(text, x, y, color=BLACK):
    render = FONT.render(text, True, color)
    screen.blit(render, (x, y))

def draw_background(time_of_day):
    # Changing background color based on time of day (for day-night cycle)
    if time_of_day < 0.5:
        # Daytime
        screen.fill(GREEN)
    else:
        # Nighttime (darker colors)
        screen.fill((0, 0, 40))

    # Adding solid grass texture (still using dark green circles as the grass)
    for x in range(0, WIDTH, 40):
        for y in range(0, HEIGHT, 40):
            pygame.draw.rect(screen, DARK_GREEN, pygame.Rect(x, y, 40, 40))

# Player class
class Player:
    def __init__(self):
        self.rect = pygame.Rect(WORLD_WIDTH // 2, WORLD_HEIGHT // 2, 40, 40)
        self.health = 100
        self.attacking = False
        self.attack_rect = pygame.Rect(0, 0, 50, 50)
        self.score = 0  # To keep track of collected health packs

    def move(self, keys):
        if keys[pygame.K_w] and self.rect.top > 0:
            self.rect.y -= PLAYER_SPEED
        if keys[pygame.K_s] and self.rect.bottom < WORLD_HEIGHT:
            self.rect.y += PLAYER_SPEED
        if keys[pygame.K_a] and self.rect.left > 0:
            self.rect.x -= PLAYER_SPEED
        if keys[pygame.K_d] and self.rect.right < WORLD_WIDTH:
            self.rect.x += PLAYER_SPEED

    def attack(self):
        self.attacking = True
        self.attack_rect.center = self.rect.center

    def take_damage(self):
        self.health -= 10
        if self.health <= 0:
            return True
        return False

    def draw(self, camera):
        # Draw player with respect to camera offset
        pygame.draw.rect(screen, GREEN, self.rect.move(-camera.camera.x, -camera.camera.y))
        if self.attacking:
            pygame.draw.rect(screen, BLACK, self.attack_rect.move(-camera.camera.x, -camera.camera.y), 2)
        pygame.draw.rect(screen, RED, (10, 10, self.health * 2, 20))  # Health bar
        draw_text(f"Health: {self.health}", 10, 40)
        draw_text(f"Score: {self.score}", WIDTH - 200, 40)

# Enemy class
class Enemy:
    def __init__(self):
        self.rect = pygame.Rect(random.randint(0, WORLD_WIDTH), random.randint(0, WORLD_HEIGHT), 30, 30)
        self.health = 50

    def move_towards_player(self, player):
        if self.rect.x < player.rect.x:
            self.rect.x += ENEMY_SPEED
        elif self.rect.x > player.rect.x:
            self.rect.x -= ENEMY_SPEED
        if self.rect.y < player.rect.y:
            self.rect.y += ENEMY_SPEED
        elif self.rect.y > player.rect.y:
            self.rect.y -= ENEMY_SPEED

    def take_damage(self):
        self.health -= 25
        if self.health <= 0:
            return True
        return False

    def draw(self, camera):
        pygame.draw.rect(screen, RED, self.rect.move(-camera.camera.x, -camera.camera.y))

# HealthPack class (for pickups)
class HealthPack:
    def __init__(self):
        self.rect = pygame.Rect(random.randint(0, WORLD_WIDTH), random.randint(0, WORLD_HEIGHT), 30, 30)

    def draw(self, camera):
        pygame.draw.rect(screen, HEALTH_PACK_COLOR, self.rect.move(-camera.camera.x, -camera.camera.y))

def death_screen():
    screen.fill(DARK_RED)
    draw_text("You Died! Press R to Respawn or Q to Quit", WIDTH // 4, HEIGHT // 2)
    pygame.display.flip()
    waiting = True
    while waiting:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                exit()
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_r:
                    waiting = False  # Respawn
                if event.key == pygame.K_q:
                    pygame.quit()
                    exit()

def reset_game():
    global player, enemies, health_packs
    player = Player()
    enemies = [Enemy() for _ in range(5)]  # More enemies
    health_packs = [HealthPack() for _ in range(3)]  # Some health packs

# Camera class to track the player's movement
class Camera:
    def __init__(self, width, height):
        self.camera = pygame.Rect(0, 0, width, height)
        self.world_size = pygame.Rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        self.camera_speed = 0.1  # Smoothing factor

    def apply(self, entity):
        # Moves the entity's rect relative to the camera's position
        return entity.rect.move(self.camera.topleft)

    def update(self, target):
        # Camera follows the player with smoothing
        target_x = -target.rect.centerx + WIDTH // 2
        target_y = -target.rect.centery + HEIGHT // 2

        # Smooth movement using lerp
        self.camera.x += (target_x - self.camera.x) * self.camera_speed
        self.camera.y += (target_y - self.camera.y) * self.camera_speed

        # Keep the camera within the bounds of the world
        self.camera.x = min(0, self.camera.x)
        self.camera.y = min(0, self.camera.y)
        self.camera.x = max(-(self.world_size.width - WIDTH), self.camera.x)
        self.camera.y = max(-(self.world_size.height - HEIGHT), self.camera.y)

    def apply_to_world(self, entity):
        return entity.move(-self.camera.x, -self.camera.y)

def draw_minimap(camera):
    minimap_width = 200
    minimap_height = 150
    minimap_scale = 0.1  # Scale down factor for the mini-map

    # Draw mini-map background
    pygame.draw.rect(screen, BLACK, (WIDTH - minimap_width - 10, 10, minimap_width, minimap_height))
    
    # Draw the world on the mini-map
    for enemy in enemies:
        enemy_pos = (enemy.rect.x * minimap_scale, enemy.rect.y * minimap_scale)
        pygame.draw.rect(screen, RED, pygame.Rect(enemy_pos[0] + WIDTH - minimap_width - 10, enemy_pos[1] + 10, 10, 10))
    
    # Draw player position on mini-map
    player_pos = (player.rect.x * minimap_scale, player.rect.y * minimap_scale)
    pygame.draw.rect(screen, GREEN, pygame.Rect(player_pos[0] + WIDTH - minimap_width - 10, player_pos[1] + 10, 10, 10))

def game_loop():
    global player, enemies, health_packs
    player = Player()
    enemies = [Enemy() for _ in range(5)]
    health_packs = [HealthPack() for _ in range(3)]
    camera = Camera(WIDTH, HEIGHT)
    running = True
    clock = pygame.time.Clock()

    time_of_day = 0.0  # Starts at day, 0.0 means 0% of the day
    day_cycle_speed = 0.001  # Speed of day-night cycle progression

    while running:
        time_of_day += day_cycle_speed
        if time_of_day > 1.0:
            time_of_day = 0.0  # Reset to the start of the day

        draw_background(time_of_day)
        keys = pygame.key.get_pressed()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    player.attack()

        player.move(keys)
        player.draw(camera)

        # Update enemies
        for enemy in enemies[:]:
            enemy.move_towards_player(player)
            enemy.draw(camera)
            if player.attacking and player.attack_rect.colliderect(enemy.rect):
                if enemy.take_damage():
                    enemies.remove(enemy)
            if player.rect.colliderect(enemy.rect):  # Enemy touches player
                if player.take_damage():
                    death_screen()
                    reset_game()

        # Update health packs
        for health_pack in health_packs[:]:
            health_pack.draw(camera)
            if player.rect.colliderect(health_pack.rect):
                player.health = min(player.health + 20, 100)  # Heal the player
                health_packs.remove(health_pack)
                player.score += 1  # Increment score for collecting health pack

        player.attacking = False  # Reset attack after one frame
        
        # Update camera position smoothly
        camera.update(player)

        # Draw the mini-map
        draw_minimap(camera)

        pygame.display.flip()
        clock.tick(60)

    pygame.quit()

reset_game()
game_loop()
